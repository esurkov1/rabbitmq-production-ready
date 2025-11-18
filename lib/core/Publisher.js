const RetryManager = require('./RetryManager');

/**
 * Publisher - Публикация сообщений в RabbitMQ
 */
class Publisher {
  constructor(connectionManager, options, logger, metrics) {
    this.connectionManager = connectionManager;
    this.options = options;
    this.logger = logger;
    this.metrics = metrics;

    // Serializer
    this.serializer =
      options.serializer ||
      ((message) => {
        if (Buffer.isBuffer(message)) {
          return message;
        }
        if (typeof message === 'string') {
          return Buffer.from(message);
        }
        return Buffer.from(JSON.stringify(message));
      });

    // Tracing и correlation
    this.tracing = options.tracing || {};
    this.correlationIdGenerator =
      options.correlationIdGenerator ||
      (() => {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      });
  }

  /**
   * Publish message to queue
   */
  async publish(queue, message, options = {}) {
    const startTime = Date.now();
    const correlationId = this._getCorrelationId(null, options);
    const traceId = this._getTraceId(options);

    try {
      const messageBuffer = this.serializer(message);
      const headers = this._buildHeaders(correlationId, traceId, options);
      const publishOptions = {
        persistent: true,
        ...options,
        headers,
      };

      // Publish с retry если включено
      const publishOperation = async () => {
        await this.connectionManager.ensureConnection();
        const channel = this.connectionManager.getChannel();
        return channel.sendToQueue(queue, messageBuffer, publishOptions);
      };

      let result;
      if (this.options.publishRetry.enabled && options.retry !== false) {
        result = await RetryManager.executeWithRetry(publishOperation, this.options.publishRetry, {
          onRetry: (error, attempt, delay) => {
            this.logger.warn(
              { err: error, queue, attempt, delay, correlationId },
              'Publish failed, retrying'
            );
            this.metrics.incrementPublishRetries();
          },
          onFailure: (error, attempts) => {
            this.logger.error(
              { err: error, queue, attempts, correlationId },
              'Publish failed after all retries'
            );
          },
        });
      } else {
        result = await publishOperation();
      }

      const duration = (Date.now() - startTime) / 1000;

      // Метрики
      this.metrics.recordPublish(queue, '', messageBuffer.length);

      // Hook
      this._callHook('onPublish', {
        queue,
        exchange: '',
        messageSize: messageBuffer.length,
        duration,
        correlationId,
      });

      this.logger.debug(
        { queue, correlationId, messageSize: messageBuffer.length },
        'Message published'
      );

      return result;
    } catch (error) {
      this.metrics.incrementPublishErrors();

      this._callHook('onError', {
        type: 'publish',
        error,
        queue,
        exchange: '',
        correlationId,
      });

      this.logger.error({ err: error, queue, correlationId }, 'Failed to publish message');
      throw error;
    }
  }

  /**
   * Publish message to exchange
   */
  async publishToExchange(exchange, routingKey, message, options = {}) {
    const startTime = Date.now();
    const correlationId = this._getCorrelationId(null, options);
    const traceId = this._getTraceId(options);

    try {
      const messageBuffer = this.serializer(message);
      const headers = this._buildHeaders(correlationId, traceId, options);
      const publishOptions = {
        persistent: true,
        ...options,
        headers,
      };

      // Publish с retry если включено
      const publishOperation = async () => {
        await this.connectionManager.ensureConnection();
        const channel = this.connectionManager.getChannel();
        return channel.publish(exchange, routingKey, messageBuffer, publishOptions);
      };

      let result;
      if (this.options.publishRetry.enabled && options.retry !== false) {
        result = await RetryManager.executeWithRetry(publishOperation, this.options.publishRetry, {
          onRetry: (error, attempt, delay) => {
            this.logger.warn(
              { err: error, exchange, routingKey, attempt, delay, correlationId },
              'Publish to exchange failed, retrying'
            );
            this.metrics.incrementPublishRetries();
          },
          onFailure: (error, attempts) => {
            this.logger.error(
              { err: error, exchange, routingKey, attempts, correlationId },
              'Publish to exchange failed after all retries'
            );
          },
        });
      } else {
        result = await publishOperation();
      }

      const duration = (Date.now() - startTime) / 1000;

      // Метрики
      this.metrics.recordPublish('', exchange, messageBuffer.length);

      // Hook
      this._callHook('onPublish', {
        queue: '',
        exchange,
        routingKey,
        messageSize: messageBuffer.length,
        duration,
        correlationId,
      });

      this.logger.debug(
        { exchange, routingKey, correlationId, messageSize: messageBuffer.length },
        'Message published to exchange'
      );

      return result;
    } catch (error) {
      this.metrics.incrementPublishErrors();

      this._callHook('onError', {
        type: 'publish',
        error,
        queue: '',
        exchange,
        routingKey,
        correlationId,
      });

      this.logger.error(
        { err: error, exchange, routingKey, correlationId },
        'Failed to publish message to exchange'
      );
      throw error;
    }
  }

  /**
   * Build headers with correlation and trace IDs
   */
  _buildHeaders(correlationId, traceId, options) {
    const headers = {
      ...options.headers,
      [this.tracing.correlationIdHeader || 'x-correlation-id']: correlationId,
    };

    // Добавляем trace ID если включен tracing
    if (this.tracing.enabled && traceId) {
      const traceHeaderName = this.tracing.headerName || 'x-trace-id';
      if (!headers[traceHeaderName]) {
        headers[traceHeaderName] = traceId;
      }
    }

    return headers;
  }

  /**
   * Get correlation ID
   */
  _getCorrelationId(msg, options) {
    if (options?.correlationId) {
      return options.correlationId;
    }

    if (msg?.properties?.headers) {
      const headerName = this.tracing.correlationIdHeader || 'x-correlation-id';
      const correlationIdFromHeaders = msg.properties.headers[headerName];
      if (correlationIdFromHeaders) {
        return correlationIdFromHeaders;
      }
    }

    return this.correlationIdGenerator();
  }

  /**
   * Get trace ID
   */
  _getTraceId(options) {
    if (options?.traceId) {
      return options.traceId;
    }

    if (this.tracing.enabled) {
      if (this.tracing.getTraceContext) {
        const traceContext = this.tracing.getTraceContext();
        if (traceContext) {
          return traceContext;
        }
      }

      // Генерируем новый trace ID
      if (this.tracing.generateTraceId) {
        return this.tracing.generateTraceId();
      }
    }

    return null;
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

module.exports = Publisher;
