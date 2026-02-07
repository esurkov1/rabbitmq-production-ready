const EventEmitter = require('events');
const pino = require('pino');

const ValidationHelper = require('./utils/ValidationHelper');
const MetricsCollector = require('./core/MetricsCollector');
const ConnectionManager = require('./core/ConnectionManager');
const Publisher = require('./core/Publisher');
const Consumer = require('./core/Consumer');
const DLQManager = require('./core/DLQManager');
const QueueManager = require('./core/QueueManager');
const ExchangeManager = require('./core/ExchangeManager');
const HealthCheckManager = require('./core/HealthCheckManager');

/**
 * RabbitMQClient - Production-ready RabbitMQ client
 *
 * Полностью отрефакторенная версия с модульной архитектурой
 */
class RabbitMQClient extends EventEmitter {
  constructor(connectionString, options = {}) {
    super();

    // Валидация
    ValidationHelper.validateConnectionString(connectionString);
    ValidationHelper.validateClientOptions(options);

    this.connectionString = connectionString;
    this.isShuttingDown = false;

    // Опции с дефолтами
    this.options = this._buildOptions(options);

    // Logger
    this.logger =
      options.logger ||
      pino({
        level: options.logLevel || 'info',
        name: 'RabbitMQClient',
      });

    // Метрики
    this.metrics = new MetricsCollector();

    // Connection Manager
    this.connectionManager = new ConnectionManager(
      connectionString,
      this.options,
      this.logger,
      this.metrics
    );

    // DLQ Manager
    this.dlqManager = new DLQManager(this.options.dlq, this.logger, this.metrics);

    // Publisher
    this.publisher = new Publisher(this.connectionManager, this.options, this.logger, this.metrics);

    // Consumer
    this.consumer = new Consumer(
      this.connectionManager,
      this.dlqManager,
      this.options,
      this.logger,
      this.metrics
    );

    // Queue Manager
    this.queueManager = new QueueManager(
      this.connectionManager,
      this.dlqManager,
      this.options,
      this.logger,
      this.metrics
    );

    // Exchange Manager
    this.exchangeManager = new ExchangeManager(this.connectionManager, this.logger, this.metrics);

    // Health Check Manager
    this.healthCheckManager = new HealthCheckManager(
      this.connectionManager,
      this.metrics,
      this.logger
    );

    // Pending operations для graceful shutdown
    this.pendingOperations = new Set();

    // Регистрируем обработчики сигналов для graceful shutdown
    this.shutdownHandlersRegistered = false;
    if (options.registerShutdownHandlers !== false) {
      this._registerShutdownHandlers();
    }

    // Проксируем события от менеджеров
    this._setupEventProxying();
  }

  /**
   * Построить полные опции с дефолтами
   */
  _buildOptions(options) {
    return {
      // Auto-reconnect
      autoReconnect: options.autoReconnect !== false,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
      initialReconnectDelay: options.initialReconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      reconnectMultiplier: options.reconnectMultiplier ?? 2,

      // Graceful shutdown
      shutdownTimeout: options.shutdownTimeout ?? 10000,

      // Publish retry
      publishRetry: {
        enabled: options.publishRetry?.enabled !== false,
        maxAttempts: options.publishRetry?.maxAttempts ?? 3,
        initialDelay: options.publishRetry?.initialDelay ?? 1000,
        maxDelay: options.publishRetry?.maxDelay ?? 10000,
        multiplier: options.publishRetry?.multiplier ?? 2,
      },

      // Consume retry
      consumeRetry: {
        enabled: options.consumeRetry?.enabled !== false,
        maxAttempts: options.consumeRetry?.maxAttempts ?? 3,
        initialDelay: options.consumeRetry?.initialDelay ?? 1000,
        maxDelay: options.consumeRetry?.maxDelay ?? 10000,
        multiplier: options.consumeRetry?.multiplier ?? 2,
      },

      // Dead Letter Queue
      dlq: {
        enabled: options.dlq?.enabled === true,
        exchange: options.dlq?.exchange ?? 'dlx',
        queuePrefix: options.dlq?.queuePrefix ?? 'dlq',
        ttl: options.dlq?.ttl ?? null,
      },

      // Serialization
      serializer: options.serializer,
      deserializer: options.deserializer,

      // Tracing (включено по умолчанию)
      tracing: {
        enabled: options.tracing?.enabled !== false, // по умолчанию true
        headerName: options.tracing?.headerName ?? 'x-trace-id',
        correlationIdHeader: options.tracing?.correlationIdHeader ?? 'x-correlation-id',
        getTraceContext: options.tracing?.getTraceContext ?? (() => null),
        setTraceContext: options.tracing?.setTraceContext ?? (() => {}),
        generateTraceId:
          options.tracing?.generateTraceId ??
          (() => {
            return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
          }),
      },

      // Hooks
      hooks: options.hooks ?? {},

      // Correlation ID generator
      correlationIdGenerator: options.correlationIdGenerator,
    };
  }

  /**
   * Проксирование событий от менеджеров
   */
  _setupEventProxying() {
    // Connection events
    this.connectionManager.on('connected', () => this.emit('connected'));
    this.connectionManager.on('reconnect', () => this.emit('reconnect'));
    this.connectionManager.on('ready', () => this.emit('ready'));
    this.connectionManager.on('disconnected', () => this.emit('disconnected'));
    this.connectionManager.on('error', (error) => this.emit('error', error));
    this.connectionManager.on('channel-error', (error) => this.emit('channel-error', error));
    this.connectionManager.on('channel-close', () => this.emit('channel-close'));
    this.connectionManager.on('channel-recreated', () => this.emit('channel-recreated'));
    this.connectionManager.on('message-returned', (msg) => this.emit('message-returned', msg));
    this.connectionManager.on('channel-drain', () => this.emit('channel-drain'));
    this.connectionManager.on('reconnecting', (data) => this.emit('reconnecting', data));
    this.connectionManager.on('reconnect-failed', (data) => this.emit('reconnect-failed', data));
    this.connectionManager.on('reconnect-max-attempts-reached', (data) =>
      this.emit('reconnect-max-attempts-reached', data)
    );
    this.connectionManager.on('close', () => this.emit('close'));

    // Queue events
    this.queueManager.on('error', (data) => this.emit('queue-error', data));

    // Exchange events
    this.exchangeManager.on('error', (data) => this.emit('exchange-error', data));
  }

  // ==================== CONNECTION ====================

  /**
   * Подключиться к RabbitMQ
   */
  async connect() {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    return this.connectionManager.connect();
  }

  /**
   * Закрыть соединение (graceful shutdown)
   */
  async close() {
    if (this.isShuttingDown) {
      return;
    }

    this.logger.info('Starting graceful shutdown');
    this.isShuttingDown = true;

    // Останавливаем всех consumers
    const consumerQueues = this.consumer.getAllConsumers().map((c) => c.queue);
    this.logger.info({ count: consumerQueues.length }, 'Stopping consumers');

    for (const queue of consumerQueues) {
      try {
        await this.consumer.stopConsuming(queue);
      } catch (error) {
        this.logger.error({ err: error, queue }, 'Error stopping consumer');
      }
    }

    // Ждем завершения операций
    await this._waitForPendingOperations();

    // Закрываем соединение
    await this.connectionManager.close();

    this.logger.info('Graceful shutdown completed');
  }

  /**
   * Проверка соединения
   */
  isConnected() {
    return this.connectionManager.isConnected();
  }

  /**
   * Ожидание подключения
   */
  async waitForConnection(timeout = 30000, interval = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.isConnected()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Connection timeout after ${timeout}ms`);
  }

  /**
   * Получить информацию о подключении
   */
  getConnectionInfo() {
    const connectionInfo = this.connectionManager.getConnectionInfo();
    const metricsData = this.metrics.getMetrics();

    return {
      ...connectionInfo,
      lastConnectionTime: metricsData.connection.lastConnectionTime,
      lastDisconnectionTime: metricsData.connection.lastDisconnectionTime,
      totalConnections: metricsData.connection.totalConnections,
      totalReconnects: metricsData.connection.totalReconnects,
      connectionErrors: metricsData.connection.connectionErrors,
    };
  }

  // ==================== PUBLISHING ====================

  /**
   * Опубликовать сообщение в очередь
   */
  async publish(queue, message, options = {}) {
    return this.publisher.publish(queue, message, options);
  }

  /**
   * Опубликовать сообщение через exchange
   */
  async publishToExchange(exchange, routingKey, message, options = {}) {
    return this.publisher.publishToExchange(exchange, routingKey, message, options);
  }

  // ==================== CONSUMING ====================

  /**
   * Начать потребление из очереди
   */
  async consume(queue, handler, options = {}) {
    return this.consumer.consume(queue, handler, options);
  }

  /**
   * Остановить потребление из очереди
   */
  async stopConsuming(queue) {
    return this.consumer.stopConsuming(queue);
  }

  /**
   * Получить список всех consumers
   */
  getAllConsumers() {
    return this.consumer.getAllConsumers();
  }

  // ==================== QUEUE MANAGEMENT ====================

  /**
   * Создать/проверить очередь
   */
  async assertQueue(queue, options = {}) {
    return this.queueManager.assertQueue(queue, options);
  }

  /**
   * Удалить очередь
   */
  async deleteQueue(queue, options = {}) {
    // Останавливаем consumer если есть
    if (this.consumer.consumers.has(queue)) {
      await this.consumer.stopConsuming(queue);
    }

    return this.queueManager.deleteQueue(queue, options);
  }

  /**
   * Очистить очередь
   */
  async purgeQueue(queue) {
    return this.queueManager.purgeQueue(queue);
  }

  /**
   * Получить информацию о очереди
   */
  async getQueueInfo(queue) {
    return this.queueManager.getQueueInfo(queue);
  }

  // ==================== EXCHANGE MANAGEMENT ====================

  /**
   * Создать/проверить exchange
   */
  async assertExchange(exchange, type, options = {}) {
    return this.exchangeManager.assertExchange(exchange, type, options);
  }

  /**
   * Удалить exchange
   */
  async deleteExchange(exchange, options = {}) {
    return this.exchangeManager.deleteExchange(exchange, options);
  }

  /**
   * Привязать очередь к exchange
   */
  async bindQueue(queue, exchange, routingKey, args = {}) {
    return this.queueManager.bindQueue(queue, exchange, routingKey, args);
  }

  /**
   * Отвязать очередь от exchange
   */
  async unbindQueue(queue, exchange, routingKey, args = {}) {
    return this.queueManager.unbindQueue(queue, exchange, routingKey, args);
  }

  /**
   * Получить информацию о exchange
   */
  async getExchangeInfo(exchange) {
    return this.exchangeManager.getExchangeInfo(exchange);
  }

  // ==================== DEAD LETTER QUEUE ====================

  /**
   * Получить имя DLQ для очереди
   */
  getDlqName(queue) {
    return this.dlqManager.getDlqName(queue);
  }

  /**
   * Создать/проверить DLQ для очереди
   */
  async assertDlq(queue) {
    await this.connectionManager.ensureConnection();
    const channel = this.connectionManager.getChannel();
    await this.dlqManager.ensureDlq(channel, queue);
    return this.getQueueInfo(this.dlqManager.getDlqName(queue));
  }

  /**
   * Получить информацию о DLQ
   */
  async getDlqInfo(queue) {
    return this.getQueueInfo(this.dlqManager.getDlqName(queue));
  }

  /**
   * Очистить DLQ
   */
  async purgeDlq(queue) {
    return this.purgeQueue(this.dlqManager.getDlqName(queue));
  }

  /**
   * Удалить DLQ
   */
  async deleteDlq(queue, options = {}) {
    return this.deleteQueue(this.dlqManager.getDlqName(queue), options);
  }

  // ==================== HEALTH & METRICS ====================

  /**
   * Health check
   */
  async healthCheck() {
    return this.healthCheckManager.performHealthCheck();
  }

  /**
   * Получить текущий статус здоровья
   */
  getHealthStatus() {
    return this.healthCheckManager.getHealthStatus();
  }

  /**
   * Получить метрики
   */
  getMetrics() {
    return this.metrics.getMetrics();
  }

  /**
   * Сбросить метрики
   */
  resetMetrics() {
    this.metrics.reset();
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Ожидание завершения операций
   */
  async _waitForPendingOperations() {
    const startTime = Date.now();
    const initialPending = this.pendingOperations.size;

    if (initialPending > 0) {
      this.logger.info({ count: initialPending }, 'Waiting for pending operations');
    }

    while (this.pendingOperations.size > 0) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= this.options.shutdownTimeout) {
        this.logger.warn(
          {
            elapsed,
            timeout: this.options.shutdownTimeout,
            pending: this.pendingOperations.size,
          },
          'Shutdown timeout reached'
        );
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (initialPending > 0) {
      this.logger.info('All pending operations completed');
    }
  }

  /**
   * Регистрация обработчиков для graceful shutdown
   */
  _registerShutdownHandlers() {
    if (this.shutdownHandlersRegistered) {
      return;
    }

    // Увеличиваем лимит слушателей для тестов
    if (process.listenerCount('SIGTERM') >= 10) {
      process.setMaxListeners(process.listenerCount('SIGTERM') + 5);
    }
    if (process.listenerCount('SIGINT') >= 10) {
      process.setMaxListeners(process.listenerCount('SIGINT') + 5);
    }

    const shutdown = async (signal) => {
      this.logger.info({ signal }, 'Received shutdown signal');
      try {
        await this.close();
        process.exit(0);
      } catch (error) {
        this.logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    this.shutdownHandlersRegistered = true;
  }
}

module.exports = RabbitMQClient;
