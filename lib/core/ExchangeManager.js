const EventEmitter = require('events');

/**
 * ExchangeManager - Управление exchange RabbitMQ
 */
class ExchangeManager extends EventEmitter {
  constructor(connectionManager, logger, metrics) {
    super();

    this.connectionManager = connectionManager;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Создать/проверить exchange
   */
  async assertExchange(exchange, type, options = {}) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const exchangeOptions = {
        durable: true,
        ...options,
      };

      const result = await channel.assertExchange(exchange, type, exchangeOptions);
      this.metrics.incrementExchangeAsserted();

      this.logger.debug({ exchange, type, options: exchangeOptions }, 'Exchange asserted');

      return result;
    } catch (error) {
      this.logger.error({ err: error, exchange, type, options }, 'Failed to assert exchange');
      this.emit('error', { operation: 'assert', exchange, type, error });
      throw error;
    }
  }

  /**
   * Удалить exchange
   */
  async deleteExchange(exchange, options = {}) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const result = await channel.deleteExchange(exchange, options);
      this.metrics.incrementExchangeDeleted();

      this.logger.debug({ exchange, options }, 'Exchange deleted');

      return result;
    } catch (error) {
      this.logger.error({ err: error, exchange, options }, 'Failed to delete exchange');
      this.emit('error', { operation: 'delete', exchange, error });
      throw error;
    }
  }

  /**
   * Получить информацию о exchange
   */
  async getExchangeInfo(exchange) {
    try {
      await this.connectionManager.ensureConnection();
      const channel = this.connectionManager.getChannel();

      const info = await channel.checkExchange(exchange);

      this.logger.debug({ exchange, info }, 'Exchange info retrieved');

      return info;
    } catch (error) {
      this.logger.error({ err: error, exchange }, 'Failed to get exchange info');
      this.emit('error', { operation: 'info', exchange, error });
      throw error;
    }
  }
}

module.exports = ExchangeManager;
