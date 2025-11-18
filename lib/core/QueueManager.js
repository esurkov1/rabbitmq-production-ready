const EventEmitter = require('events');

/**
 * QueueManager - Управление очередями RabbitMQ
 */
class QueueManager extends EventEmitter {
  constructor(connectionManager, dlqManager, options, logger, metrics) {
    super();

    this.connectionManager = connectionManager;
    this.dlqManager = dlqManager;
    this.options = options;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Создать/проверить очередь
   */
  async assertQueue(queue, options = {}) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const queueOptions = {
        durable: true,
        ...options,
      };

      // Если DLQ включен и не отключен явно для этой очереди
      if (this.options.dlq.enabled && options.dlq !== false) {
        await this.dlqManager.ensureDlq(channel, queue);

        if (!queueOptions.arguments) {
          queueOptions.arguments = {};
        }

        const dlqArgs = this.dlqManager.getQueueArguments(queue);
        Object.assign(queueOptions.arguments, dlqArgs);
      }

      const result = await channel.assertQueue(queue, queueOptions);
      this.metrics.incrementQueueAsserted();

      this.logger.debug({ queue, options: queueOptions }, 'Queue asserted');

      return result;
    } catch (error) {
      this.logger.error({ err: error, queue, options }, 'Failed to assert queue');

      // Emit событие ошибки для внешних обработчиков
      this.emit('error', { operation: 'assert', queue, error });

      // Пробрасываем ошибку дальше
      throw error;
    }
  }

  /**
   * Удалить очередь
   */
  async deleteQueue(queue, options = {}) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const result = await channel.deleteQueue(queue, options);
      this.metrics.incrementQueueDeleted();

      this.logger.debug({ queue, options }, 'Queue deleted');

      return result;
    } catch (error) {
      this.logger.error({ err: error, queue, options }, 'Failed to delete queue');
      this.emit('error', { operation: 'delete', queue, error });
      throw error;
    }
  }

  /**
   * Очистить очередь
   */
  async purgeQueue(queue) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const result = await channel.purgeQueue(queue);
      this.metrics.incrementQueuePurged();

      this.logger.debug({ queue }, 'Queue purged');

      return result;
    } catch (error) {
      this.logger.error({ err: error, queue }, 'Failed to purge queue');
      this.emit('error', { operation: 'purge', queue, error });
      throw error;
    }
  }

  /**
   * Получить информацию о очереди
   */
  async getQueueInfo(queue) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const info = await channel.checkQueue(queue);

      this.logger.debug({ queue, info }, 'Queue info retrieved');

      return info;
    } catch (error) {
      this.logger.error({ err: error, queue }, 'Failed to get queue info');
      this.emit('error', { operation: 'info', queue, error });
      throw error;
    }
  }

  /**
   * Привязать очередь к exchange
   */
  async bindQueue(queue, exchange, routingKey, args = {}) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const result = await channel.bindQueue(queue, exchange, routingKey, args);
      this.metrics.incrementExchangeBindings();

      this.logger.debug({ queue, exchange, routingKey, args }, 'Queue bound to exchange');

      return result;
    } catch (error) {
      this.logger.error({ err: error, queue, exchange, routingKey, args }, 'Failed to bind queue');
      this.emit('error', { operation: 'bind', queue, exchange, routingKey, error });
      throw error;
    }
  }

  /**
   * Отвязать очередь от exchange
   */
  async unbindQueue(queue, exchange, routingKey, args = {}) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const result = await channel.unbindQueue(queue, exchange, routingKey, args);

      this.logger.debug({ queue, exchange, routingKey, args }, 'Queue unbound from exchange');

      return result;
    } catch (error) {
      this.logger.error(
        { err: error, queue, exchange, routingKey, args },
        'Failed to unbind queue'
      );
      this.emit('error', { operation: 'unbind', queue, exchange, routingKey, error });
      throw error;
    }
  }
}

module.exports = QueueManager;
