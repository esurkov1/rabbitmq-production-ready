const RetryManager = require('./RetryManager');

/**
 * Consumer - Обработка потребления сообщений из RabbitMQ
 */
class Consumer {
  constructor(connectionManager, dlqManager, options, logger, metrics) {
    this.connectionManager = connectionManager;
    this.dlqManager = dlqManager;
    this.options = options;
    this.logger = logger;
    this.metrics = metrics;

    // Consumers tracking
    this.consumers = new Map(); // queue -> { consumerTag, handler }

    // Deserializer
    this.deserializer =
      options.deserializer ||
      ((buffer) => {
        try {
          return JSON.parse(buffer.toString());
        } catch (e) {
          return buffer.toString();
        }
      });

    // Tracing
    this.tracing = options.tracing || {};
  }

  /**
   * Начать потребление сообщений из очереди
   */
  async consume(queue, handler, options = {}) {
    await this.connectionManager.ensureConnection();

    // Если уже есть consumer для этой очереди, останавливаем его
    if (this.consumers.has(queue)) {
      await this.stopConsuming(queue);
    }

    const consumeOptions = {
      noAck: false,
      ...options,
    };

    // Устанавливаем prefetch если указан
    if (options.prefetch !== undefined) {
      const channel = this.connectionManager.getChannel();
      await channel.prefetch(options.prefetch);
    }

    const channel = this.connectionManager.getChannel();
    const result = await channel.consume(
      queue,
      async (msg) => {
        if (!msg) {
          return;
        }

        await this._processMessage(queue, msg, handler, consumeOptions);
      },
      consumeOptions
    );

    this.consumers.set(queue, {
      consumerTag: result.consumerTag,
      handler: handler,
    });

    this.logger.info(
      {
        queue,
        consumerTag: result.consumerTag,
        prefetch: options.prefetch,
      },
      'Consumer started'
    );

    return result.consumerTag;
  }

  /**
   * Обработать сообщение
   */
  async _processMessage(queue, msg, handler, options) {
    // Устанавливаем trace context из заголовков
    this._setTraceContextFromMessage(msg);

    const startTime = Date.now();
    const retryCount = RetryManager.getRetryCount(msg);
    const correlationId = this._getCorrelationId(msg);
    const maxRetries = this._getMaxRetries(options, retryCount);
    const useRetry = this._shouldUseRetry(options, retryCount, maxRetries);

    try {
      // Задержка для retry если нужно
      if (useRetry && retryCount > 0) {
        const delay = RetryManager.calculateDelay(
          retryCount,
          this.options.consumeRetry.initialDelay,
          this.options.consumeRetry.maxDelay,
          this.options.consumeRetry.multiplier
        );
        this.logger.debug({ queue, correlationId, retryCount, delay }, 'Retrying message');
        await RetryManager.sleep(delay);
      }

      this.logger.debug({ queue, correlationId, retryCount }, 'Processing message');

      // Десериализация и обработка
      const deserializedContent = this.deserializer(msg.content);
      const enhancedMsg = {
        ...msg,
        content: msg.content,
        parsedContent: deserializedContent,
      };

      await handler(enhancedMsg);

      // Успешная обработка
      const processingTime = Date.now() - startTime;
      this.metrics.recordConsume(queue, processingTime);

      // Hook
      this._callHook('onConsume', {
        queue,
        processingTime: processingTime / 1000,
        correlationId,
        retryCount,
      });

      this.logger.debug({ queue, correlationId, processingTime }, 'Message processed');

      // Acknowledge если noAck=false
      if (!options.noAck) {
        const channel = this.connectionManager.getChannel();
        channel.ack(msg);
      }
    } catch (error) {
      this.logger.error(
        { err: error, queue, correlationId, attempt: retryCount + 1 },
        'Error processing message'
      );

      this.metrics.incrementConsumeErrors();

      // Hook
      this._callHook('onError', {
        type: 'consume',
        error,
        queue,
        correlationId,
        retryCount,
      });

      if (!options.noAck) {
        await this._handleConsumeError(queue, msg, error, options, retryCount, maxRetries);
      }
    }
  }

  /**
   * Обработать ошибку при потреблении
   */
  async _handleConsumeError(queue, msg, error, options, retryCount, maxRetries) {
    const channel = this.connectionManager.getChannel();
    const correlationId = this._getCorrelationId(msg);

    // Если есть еще попытки и retry включен - переотправляем в очередь
    if (
      this.options.consumeRetry.enabled &&
      options.retry !== false &&
      retryCount < maxRetries
    ) {
      const newHeaders = RetryManager.incrementRetryCount(msg);

      try {
        const republishOptions = {
          persistent: msg.properties.deliveryMode === 2,
          headers: newHeaders,
          contentType: msg.properties.contentType,
          contentEncoding: msg.properties.contentEncoding,
          priority: msg.properties.priority,
          correlationId: msg.properties.correlationId,
          replyTo: msg.properties.replyTo,
          expiration: msg.properties.expiration,
          messageId: msg.properties.messageId,
          timestamp: msg.properties.timestamp,
          type: msg.properties.type,
          userId: msg.properties.userId,
          appId: msg.properties.appId,
        };

        await channel.sendToQueue(queue, msg.content, republishOptions);
        channel.ack(msg);
        this.metrics.incrementConsumeRetries();

        this.logger.info({ queue, correlationId, retryCount: retryCount + 1 }, 'Message requeued');
        return;
      } catch (republishError) {
        this.logger.error({ err: republishError, queue, correlationId }, 'Failed to republish');
      }
    }

    // Попытки исчерпаны - отправляем в DLQ или отклоняем
    const shouldSendToDlq = this.dlqManager.config.enabled && retryCount >= maxRetries;
    const requeue = !shouldSendToDlq && options.requeue !== false;

    if (shouldSendToDlq) {
      await this.dlqManager.sendToDlq(channel, queue, msg, error, correlationId);
      channel.ack(msg);
      this.logger.warn({ queue, correlationId, retryCount }, 'Message sent to DLQ');
    } else {
      if (requeue) {
        this.metrics.incrementRequeued();
      }
      channel.nack(msg, false, requeue);
      this.logger.warn({ queue, correlationId, requeue }, 'Message nacked');
    }
  }

  /**
   * Остановить потребление из очереди
   */
  async stopConsuming(queue) {
    const consumer = this.consumers.get(queue);
    if (!consumer) {
      return;
    }

    const channel = this.connectionManager.getChannel();
    if (channel) {
      try {
        await channel.cancel(consumer.consumerTag);
        this.logger.info({ queue, consumerTag: consumer.consumerTag }, 'Consumer stopped');
      } catch (error) {
        this.logger.error(
          { err: error, queue, consumerTag: consumer.consumerTag },
          'Error canceling consumer'
        );
      }
    }

    this.consumers.delete(queue);
  }

  /**
   * Получить список всех активных consumers
   */
  getAllConsumers() {
    return Array.from(this.consumers.entries()).map(([queue, consumer]) => ({
      queue,
      consumerTag: consumer.consumerTag,
    }));
  }

  /**
   * Get correlation ID
   */
  _getCorrelationId(msg) {
    if (msg?.properties?.headers) {
      const headerName = this.tracing.correlationIdHeader || 'x-correlation-id';
      const correlationIdFromHeaders = msg.properties.headers[headerName];
      if (correlationIdFromHeaders) {
        return correlationIdFromHeaders;
      }
    }
    return 'unknown';
  }

  /**
   * Get max retries
   */
  _getMaxRetries(options, retryCount) {
    return options.maxRetries !== undefined
      ? options.maxRetries
      : this.options.consumeRetry.enabled
        ? this.options.consumeRetry.maxAttempts
        : 0;
  }

  /**
   * Should use retry
   */
  _shouldUseRetry(options, retryCount, maxRetries) {
    return (
      options.retry !== false &&
      this.options.consumeRetry.enabled &&
      retryCount < maxRetries
    );
  }

  /**
   * Set trace context from message
   */
  _setTraceContextFromMessage(msg) {
    if (!this.tracing.enabled || !msg?.properties?.headers) {
      return;
    }

    const headers = msg.properties.headers;
    const traceId = headers[this.tracing.headerName || 'x-trace-id'];

    if (traceId && this.tracing.setTraceContext) {
      try {
        this.tracing.setTraceContext(traceId);
      } catch (error) {
        this.logger.warn({ err: error }, 'Error setting trace context');
      }
    }
  }

  /**
   * Call hook if defined
   */
  _callHook(hookName, data) {
    const hook = this.options.hooks?.[hookName];
    if (hook && typeof hook === 'function') {
      try {
        hook(data);
      } catch (error) {
        this.logger.warn({ err: error, hookName }, `Error in ${hookName} hook`);
      }
    }
  }
}

module.exports = Consumer;

