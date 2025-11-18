const RetryManager = require('./RetryManager');

/**
 * DLQManager - Управление Dead Letter Queue
 */
class DLQManager {
  constructor(dlqConfig, logger, metrics) {
    this.config = dlqConfig;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Получить имя DLQ для очереди
   */
  getDlqName(queue) {
    return `${this.config.queuePrefix}.${queue}`;
  }

  /**
   * Создать DLQ инфраструктуру для очереди
   */
  async ensureDlq(channel, queue) {
    if (!this.config.enabled) {
      return;
    }

    const dlqName = this.getDlqName(queue);
    const dlxName = this.config.exchange;

    // Создаем DLX exchange
    await channel.assertExchange(dlxName, 'direct', { durable: true });

    // Создаем DLQ с опциями
    const dlqOptions = {
      durable: true,
      arguments: {},
    };

    if (this.config.ttl) {
      dlqOptions.arguments['x-message-ttl'] = this.config.ttl;
    }

    await channel.assertQueue(dlqName, dlqOptions);

    // Привязываем DLQ к DLX
    await channel.bindQueue(dlqName, dlxName, queue);

    this.logger.debug({ queue, dlqName, dlxName }, 'DLQ infrastructure ensured');
  }

  /**
   * Отправить сообщение в DLQ
   */
  async sendToDlq(channel, queue, originalMessage, error, correlationId) {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.ensureDlq(channel, queue);

      const dlxName = this.config.exchange;
      const messageBuffer = originalMessage.content;

      // Добавляем метаданные об ошибке в заголовки
      const headers = originalMessage.properties.headers || {};
      const retryCount = RetryManager.getRetryCount(originalMessage);

      const options = {
        persistent: true,
        headers: {
          ...headers,
          'x-original-queue': queue,
          'x-failed-reason': error.message || 'Unknown error',
          'x-failed-at': new Date().toISOString(),
          'x-retry-count': retryCount,
        },
        contentType: originalMessage.properties.contentType,
        contentEncoding: originalMessage.properties.contentEncoding,
        deliveryMode: originalMessage.properties.deliveryMode,
        priority: originalMessage.properties.priority,
        correlationId: originalMessage.properties.correlationId,
        replyTo: originalMessage.properties.replyTo,
        expiration: originalMessage.properties.expiration,
        messageId: originalMessage.properties.messageId,
        timestamp: originalMessage.properties.timestamp,
        type: originalMessage.properties.type,
        userId: originalMessage.properties.userId,
        appId: originalMessage.properties.appId,
      };

      await channel.publish(dlxName, queue, messageBuffer, options);
      this.metrics.incrementSentToDlq();

      this.logger.warn(
        {
          queue,
          correlationId,
          dlq: this.getDlqName(queue),
          error: error.message,
        },
        'Message sent to DLQ'
      );
    } catch (dlqError) {
      this.logger.error(
        {
          err: dlqError,
          queue,
        },
        'Failed to send message to DLQ'
      );
    }
  }

  /**
   * Получить аргументы для настройки очереди с DLQ
   */
  getQueueArguments(queue) {
    if (!this.config.enabled) {
      return {};
    }

    return {
      'x-dead-letter-exchange': this.config.exchange,
      'x-dead-letter-routing-key': queue,
    };
  }
}

module.exports = DLQManager;
