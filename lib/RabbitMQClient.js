const amqp = require('amqplib');
const EventEmitter = require('events');
const pino = require('pino');

class RabbitMQClient extends EventEmitter {
  constructor(connectionString, options = {}) {
    super();

    // Валидация конфигурации
    this._validateConfig(connectionString, options);

    this.connectionString = connectionString;
    this.connection = null;
    this.channel = null;

    // Логирование
    this.logger =
      options.logger ||
      pino({
        level: options.logLevel || 'info',
        name: 'RabbitMQClient',
      });

    // Hooks для интеграции с внешними системами (например, Prometheus)
    this.hooks = {
      onPublish: options.hooks?.onPublish || null,
      onConsume: options.hooks?.onConsume || null,
      onError: options.hooks?.onError || null,
      onConnectionChange: options.hooks?.onConnectionChange || null,
    };

    // Health check
    this.healthStatus = {
      status: 'unknown',
      lastCheck: null,
      details: {},
    };

    // Correlation IDs - упрощенная логика
    this.correlationIdGenerator =
      options.correlationIdGenerator ||
      (() => {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      });

    // Auto-reconnect settings
    this.autoReconnect = options.autoReconnect !== false; // по умолчанию включен
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || Infinity;
    this.initialReconnectDelay = options.initialReconnectDelay || 1000; // начальная задержка в мс
    this.maxReconnectDelay = options.maxReconnectDelay || 30000; // максимальная задержка в мс
    this.reconnectMultiplier = options.reconnectMultiplier || 2;
    this.reconnectTimer = null;

    // Graceful shutdown
    this.isShuttingDown = false;
    this.pendingOperations = new Set();
    this.shutdownTimeout = options.shutdownTimeout || 10000; // таймаут для graceful shutdown
    this.shutdownHandlersRegistered = false;

    // Регистрируем обработчики сигналов для graceful shutdown
    if (options.registerShutdownHandlers !== false) {
      this._registerShutdownHandlers();
    }

    // Consumers tracking
    this.consumers = new Map(); // queue -> { consumerTag, handler }

    // Retry settings
    this.publishRetry = {
      enabled: options.publishRetry?.enabled !== false, // по умолчанию включен
      maxAttempts: options.publishRetry?.maxAttempts || 3,
      initialDelay: options.publishRetry?.initialDelay || 1000,
      maxDelay: options.publishRetry?.maxDelay || 10000,
      multiplier: options.publishRetry?.multiplier || 2,
    };

    this.consumeRetry = {
      enabled: options.consumeRetry?.enabled !== false, // по умолчанию включен
      maxAttempts: options.consumeRetry?.maxAttempts || 3,
      initialDelay: options.consumeRetry?.initialDelay || 1000,
      maxDelay: options.consumeRetry?.maxDelay || 10000,
      multiplier: options.consumeRetry?.multiplier || 2,
    };

    // Dead Letter Queue settings
    this.dlq = {
      enabled: options.dlq?.enabled === true, // по умолчанию выключен
      exchange: options.dlq?.exchange || 'dlx',
      queuePrefix: options.dlq?.queuePrefix || 'dlq',
      ttl: options.dlq?.ttl || null, // TTL для сообщений в DLQ (в мс)
    };

    // Metrics
    this.metrics = {
      connection: {
        totalConnections: 0,
        totalReconnects: 0,
        connectionErrors: 0,
        lastConnectionTime: null,
        lastDisconnectionTime: null,
      },
      publish: {
        totalPublished: 0,
        publishedByQueue: new Map(), // queue -> count
        publishedByExchange: new Map(), // exchange -> count
        publishErrors: 0,
        publishRetries: 0,
        totalBytesPublished: 0,
      },
      consume: {
        totalConsumed: 0,
        consumedByQueue: new Map(), // queue -> count
        consumeErrors: 0,
        consumeRetries: 0,
        requeued: 0,
        sentToDlq: 0,
        totalProcessingTime: 0, // суммарное время обработки в мс
        minProcessingTime: null,
        maxProcessingTime: null,
      },
      queue: {
        totalAsserted: 0,
        totalDeleted: 0,
        totalPurged: 0,
      },
      exchange: {
        totalAsserted: 0,
        totalDeleted: 0,
        totalBindings: 0,
      },
    };
  }

  /**
   * Валидация конфигурации
   * @private
   */
  _validateConfig(connectionString, options) {
    if (!connectionString || typeof connectionString !== 'string') {
      throw new Error('connectionString must be a non-empty string');
    }

    // Валидация URL формата
    try {
      new URL(connectionString);
    } catch (e) {
      // Если не URL, проверяем что это строка формата amqp://...
      if (!connectionString.startsWith('amqp://') && !connectionString.startsWith('amqps://')) {
        throw new Error('connectionString must be a valid AMQP URL (amqp:// or amqps://)');
      }
    }

    if (
      options.maxReconnectAttempts !== undefined &&
      (typeof options.maxReconnectAttempts !== 'number' || options.maxReconnectAttempts < 0)
    ) {
      throw new Error('maxReconnectAttempts must be a non-negative number');
    }

    if (
      options.shutdownTimeout !== undefined &&
      (typeof options.shutdownTimeout !== 'number' || options.shutdownTimeout < 0)
    ) {
      throw new Error('shutdownTimeout must be a non-negative number');
    }

    if (
      options.initialReconnectDelay !== undefined &&
      (typeof options.initialReconnectDelay !== 'number' || options.initialReconnectDelay < 0)
    ) {
      throw new Error('initialReconnectDelay must be a non-negative number');
    }

    if (
      options.maxReconnectDelay !== undefined &&
      (typeof options.maxReconnectDelay !== 'number' || options.maxReconnectDelay < 0)
    ) {
      throw new Error('maxReconnectDelay must be a non-negative number');
    }

    if (
      options.reconnectMultiplier !== undefined &&
      (typeof options.reconnectMultiplier !== 'number' || options.reconnectMultiplier <= 0)
    ) {
      throw new Error('reconnectMultiplier must be a positive number');
    }

    // Валидация retry конфигов
    if (options.publishRetry) {
      this._validateRetryConfig(options.publishRetry, 'publishRetry');
    }

    if (options.consumeRetry) {
      this._validateRetryConfig(options.consumeRetry, 'consumeRetry');
    }

    // Валидация DLQ конфига
    if (options.dlq) {
      if (
        options.dlq.exchange !== undefined &&
        (typeof options.dlq.exchange !== 'string' || !options.dlq.exchange)
      ) {
        throw new Error('dlq.exchange must be a non-empty string');
      }
      if (
        options.dlq.queuePrefix !== undefined &&
        (typeof options.dlq.queuePrefix !== 'string' || !options.dlq.queuePrefix)
      ) {
        throw new Error('dlq.queuePrefix must be a non-empty string');
      }
      if (
        options.dlq.ttl !== undefined &&
        options.dlq.ttl !== null &&
        (typeof options.dlq.ttl !== 'number' || options.dlq.ttl < 0)
      ) {
        throw new Error('dlq.ttl must be a non-negative number or null');
      }
    }
  }

  /**
   * Валидация конфига retry
   * @private
   */
  _validateRetryConfig(retryConfig, configName) {
    if (
      retryConfig.maxAttempts !== undefined &&
      (typeof retryConfig.maxAttempts !== 'number' || retryConfig.maxAttempts < 1)
    ) {
      throw new Error(`${configName}.maxAttempts must be a positive number`);
    }
    if (
      retryConfig.initialDelay !== undefined &&
      (typeof retryConfig.initialDelay !== 'number' || retryConfig.initialDelay < 0)
    ) {
      throw new Error(`${configName}.initialDelay must be a non-negative number`);
    }
    if (
      retryConfig.maxDelay !== undefined &&
      (typeof retryConfig.maxDelay !== 'number' || retryConfig.maxDelay < 0)
    ) {
      throw new Error(`${configName}.maxDelay must be a non-negative number`);
    }
    if (
      retryConfig.multiplier !== undefined &&
      (typeof retryConfig.multiplier !== 'number' || retryConfig.multiplier <= 0)
    ) {
      throw new Error(`${configName}.multiplier must be a positive number`);
    }
  }

  /**
   * Генерация correlation ID
   * @private
   */
  _generateCorrelationId() {
    return this.correlationIdGenerator();
  }

  /**
   * Получить correlation ID из заголовков или сгенерировать новый
   * @private
   */
  _getCorrelationId(msg, options) {
    if (options?.correlationId) {
      return options.correlationId;
    }

    if (msg?.properties?.headers?.['x-correlation-id']) {
      return msg.properties.headers['x-correlation-id'];
    }

    return this._generateCorrelationId();
  }

  /**
   * Health check
   * @returns {Promise<Object>}
   */
  async healthCheck() {
    const checkTime = Date.now();
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {},
    };

    try {
      // Проверка соединения
      const isConnected = this.isConnected();
      health.checks.connection = {
        status: isConnected ? 'healthy' : 'unhealthy',
        message: isConnected ? 'Connected' : 'Not connected',
      };

      // Проверка активных consumers
      health.checks.consumers = {
        status: 'healthy',
        count: this.consumers.size,
        queues: Array.from(this.consumers.keys()),
      };

      // Определяем общий статус
      health.status = isConnected ? 'healthy' : 'unhealthy';

      this.healthStatus = {
        status: health.status,
        lastCheck: checkTime,
        details: health,
      };

      return health;
    } catch (error) {
      this.logger.error({ err: error }, 'Health check failed');
      health.status = 'unhealthy';
      health.error = error.message;

      this.healthStatus = {
        status: 'unhealthy',
        lastCheck: checkTime,
        details: health,
      };

      return health;
    }
  }

  /**
   * Подключение к RabbitMQ
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    if (this.isConnected()) {
      return;
    }

    return this._connect();
  }

  /**
   * Внутренний метод подключения
   * @private
   */
  async _connect() {
    try {
      // Очищаем старое соединение перед переподключением
      if (this.connection) {
        try {
          if (this.channel) {
            await this.channel.close();
          }
          await this.connection.close();
        } catch (err) {
          this.logger.debug({ err }, 'Error closing old connection');
        }
        this.connection = null;
        this.channel = null;
      }

      this.logger.info('Connecting to RabbitMQ');

      // Подключаемся к RabbitMQ
      this.connection = await amqp.connect(this.connectionString);
      this.channel = await this.connection.createChannel();

      // Настраиваем обработчики событий
      this._setupConnectionHandlers(this.connection, this.channel);

      // Сбрасываем счетчик попыток переподключения при успешном подключении
      const wasReconnect = this.reconnectAttempts > 0;
      if (wasReconnect) {
        this.metrics.connection.totalReconnects++;
        this.logger.info('Reconnected to RabbitMQ');
        this.emit('reconnect');
      } else {
        this.logger.info('Connected to RabbitMQ');
        this.emit('connected');
      }
      this.reconnectAttempts = 0;

      // Обновляем метрики подключения
      this.metrics.connection.totalConnections++;
      this.metrics.connection.lastConnectionTime = Date.now();

      // Генерируем событие ready после успешного подключения
      this.emit('ready');

      // Вызываем hook для изменения соединения
      if (this.hooks.onConnectionChange) {
        try {
          this.hooks.onConnectionChange({ connected: true, wasReconnect });
        } catch (hookError) {
          this.logger.warn({ err: hookError }, 'Error in onConnectionChange hook');
        }
      }
    } catch (error) {
      this.connection = null;
      this.channel = null;

      // Обновляем метрики ошибок подключения
      this.metrics.connection.connectionErrors++;

      this.logger.error({ err: error }, 'Failed to connect to RabbitMQ');

      // Генерируем событие ошибки
      this.emit('error', error);

      // Автоматическое переподключение
      if (this.autoReconnect && !this.isShuttingDown) {
        this._scheduleReconnect();
      }

      throw error;
    }
  }

  /**
   * Настройка обработчиков событий соединения
   * @private
   */
  _setupConnectionHandlers(connection, channel) {
    connection.on('close', () => {
      // Очищаем соединение
      if (connection === this.connection) {
        this.connection = null;
        this.channel = null;
        // Обновляем метрики отключения
        this.metrics.connection.lastDisconnectionTime = Date.now();

        // Вызываем hook для изменения соединения
        if (this.hooks.onConnectionChange && !this.isShuttingDown) {
          try {
            this.hooks.onConnectionChange({ connected: false });
          } catch (hookError) {
            this.logger.warn({ err: hookError }, 'Error in onConnectionChange hook');
          }
        }

        // Генерируем событие отключения
        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ connection closed');
          this.emit('disconnected');
        }
      }

      if (!this.isShuttingDown && this.autoReconnect && !this.reconnectTimer) {
        this._scheduleReconnect();
      }
    });

    connection.on('error', (err) => {
      this.logger.error({ err }, 'RabbitMQ connection error');
      // Обновляем метрики ошибок подключения
      this.metrics.connection.connectionErrors++;

      // Генерируем событие ошибки
      this.emit('error', err);

      if (!this.isShuttingDown && this.autoReconnect && !this.reconnectTimer) {
        this._scheduleReconnect();
      }
    });

    // Обработчики событий канала
    channel.on('error', (err) => {
      this.logger.error({ err }, 'RabbitMQ channel error');
      this.emit('channel-error', err);
    });

    channel.on('close', () => {
      this.emit('channel-close');
    });

    channel.on('return', (msg) => {
      this.emit('message-returned', msg);
    });

    channel.on('drain', () => {
      this.emit('channel-drain');
    });
  }

  /**
   * Планирование переподключения с exponential backoff
   * @private
   */
  _scheduleReconnect() {
    if (this.isShuttingDown || this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        {
          attempts: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
        },
        'Max reconnect attempts reached'
      );
      this.emit('reconnect-max-attempts-reached', {
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      });
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff: initialDelay * (multiplier ^ (attempts - 1))
    // При первой попытке (attempts=1) задержка = initialDelay
    // При второй попытке (attempts=2) задержка = initialDelay * multiplier
    const delay = Math.min(
      this.initialReconnectDelay * Math.pow(this.reconnectMultiplier, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    this.logger.info(
      {
        attempt: this.reconnectAttempts,
        delay,
      },
      'Scheduling reconnect'
    );

    // Генерируем событие начала переподключения
    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.isShuttingDown) {
        return;
      }

      try {
        await this._connect();
      } catch (error) {
        this.logger.error(
          {
            err: error,
            attempt: this.reconnectAttempts,
          },
          'Reconnect failed'
        );

        // Генерируем событие неудачного переподключения
        this.emit('reconnect-failed', {
          attempt: this.reconnectAttempts,
          error: error,
        });

        // Планируем следующую попытку
        if (!this.isShuttingDown) {
          this._scheduleReconnect();
        } else {
          // Если достигнут максимум попыток и идет shutdown
          this.emit('reconnect-max-attempts-reached');
        }
      }
    }, delay);
  }

  /**
   * Регистрация обработчиков сигналов для graceful shutdown
   * @private
   */
  _registerShutdownHandlers() {
    if (this.shutdownHandlersRegistered) {
      return;
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

  /**
   * Graceful shutdown
   * @returns {Promise<void>}
   */
  async close() {
    if (this.isShuttingDown) {
      return;
    }

    this.logger.info('Starting graceful shutdown');
    this.isShuttingDown = true;

    // Отменяем запланированное переподключение
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Останавливаем все активные consumers
    const consumerQueues = Array.from(this.consumers.keys());
    this.logger.info({ count: consumerQueues.length }, 'Stopping consumers');
    for (const queue of consumerQueues) {
      try {
        await this.stopConsuming(queue);
      } catch (error) {
        this.logger.error({ err: error, queue }, 'Error stopping consumer');
      }
    }

    // Ждем завершения всех операций или таймаут
    await this._waitForPendingOperations();

    // Закрываем соединение
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.logger.info('Connection closed successfully');
    } catch (error) {
      this.logger.debug({ err: error }, 'Error closing connection (may already be closed)');
      // Игнорируем ошибки при закрытии уже закрытого соединения
      this.connection = null;
      this.channel = null;
    }

    // Генерируем событие закрытия
    this.emit('close');
    this.logger.info('Graceful shutdown completed');
  }

  /**
   * Ожидание завершения всех операций
   * @private
   */
  async _waitForPendingOperations() {
    const startTime = Date.now();
    const initialPending = this.pendingOperations.size;

    if (initialPending > 0) {
      this.logger.info({ count: initialPending }, 'Waiting for pending operations to complete');
    }

    while (this.pendingOperations.size > 0) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= this.shutdownTimeout) {
        this.logger.warn(
          {
            elapsed,
            timeout: this.shutdownTimeout,
            pending: this.pendingOperations.size,
          },
          'Shutdown timeout reached, forcing close'
        );
        break;
      }

      // Ждем немного перед следующей проверкой
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (initialPending > 0) {
      this.logger.info('All pending operations completed');
    }
  }

  /**
   * Регистрация операции для отслеживания
   * @param {string} operationId
   */
  _registerOperation(operationId) {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }
    this.pendingOperations.add(operationId);
  }

  /**
   * Отмена регистрации операции
   * @param {string} operationId
   */
  _unregisterOperation(operationId) {
    this.pendingOperations.delete(operationId);
  }

  /**
   * Проверка соединения
   * @returns {boolean}
   */
  isConnected() {
    if (!this.connection || !this.channel) {
      return false;
    }

    try {
      const socket = this.connection.connection;
      return socket && !socket.destroyed && socket.readyState === 'open';
    } catch (error) {
      return false;
    }
  }

  /**
   * Ожидание подключения с таймаутом
   * @param {number} timeout - Таймаут в миллисекундах (по умолчанию 30000)
   * @param {number} interval - Интервал проверки в миллисекундах (по умолчанию 100)
   * @returns {Promise<void>}
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
   * Получить информацию о соединении
   * @returns {Object}
   */
  getConnectionInfo() {
    return {
      connected: this.isConnected(),
      connectionString: this.connectionString,
      reconnectAttempts: this.reconnectAttempts,
      autoReconnect: this.autoReconnect,
      maxReconnectAttempts: this.maxReconnectAttempts,
      lastConnectionTime: this.metrics.connection.lastConnectionTime,
      lastDisconnectionTime: this.metrics.connection.lastDisconnectionTime,
      totalConnections: this.metrics.connection.totalConnections,
      totalReconnects: this.metrics.connection.totalReconnects,
      connectionErrors: this.metrics.connection.connectionErrors,
    };
  }

  /**
   * Получить список всех активных consumers
   * @returns {Array<Object>}
   */
  getAllConsumers() {
    return Array.from(this.consumers.entries()).map(([queue, consumer]) => ({
      queue,
      consumerTag: consumer.consumerTag,
    }));
  }

  /**
   * Убедиться, что есть подключение и канал
   * @private
   */
  async _ensureConnection() {
    if (!this.isConnected()) {
      await this.connect();
    }
    if (!this.channel) {
      const error = new Error('Channel is not available');
      this.logger.error('Channel is not available');
      throw error;
    }
  }

  /**
   * Вычислить задержку для retry с exponential backoff
   * @private
   */
  _calculateRetryDelay(attempt, initialDelay, maxDelay, multiplier) {
    const delay = Math.min(initialDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    return delay;
  }

  /**
   * Выполнить операцию с retry
   * @private
   */
  async _retryOperation(operation, retryConfig, operationName) {
    let lastError;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        if (attempt > 1) {
          this.logger.info(
            {
              operation: operationName,
              attempt,
              maxAttempts: retryConfig.maxAttempts,
            },
            'Operation succeeded after retry'
          );
        }

        return result;
      } catch (error) {
        lastError = error;

        if (attempt < retryConfig.maxAttempts) {
          const delay = this._calculateRetryDelay(
            attempt,
            retryConfig.initialDelay,
            retryConfig.maxDelay,
            retryConfig.multiplier
          );

          this.logger.warn(
            {
              err: error,
              operation: operationName,
              attempt,
              maxAttempts: retryConfig.maxAttempts,
              delay,
            },
            'Operation failed, retrying'
          );

          if (operationName === 'publish') {
            this.metrics.publish.publishRetries++;
          } else if (operationName === 'consume') {
            this.metrics.consume.consumeRetries++;
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(
      {
        err: lastError,
        operation: operationName,
        attempts: retryConfig.maxAttempts,
      },
      'Operation failed after all retries'
    );

    throw lastError;
  }

  /**
   * Получить имя DLQ для очереди
   * @private
   */
  _getDlqName(queue) {
    return `${this.dlq.queuePrefix}.${queue}`;
  }

  /**
   * Убедиться, что DLQ и exchange созданы
   * @private
   */
  async _ensureDlq(queue) {
    if (!this.dlq.enabled) {
      return;
    }

    await this._ensureConnection();

    const dlqName = this._getDlqName(queue);
    const dlxName = this.dlq.exchange;

    // Создаем DLX exchange
    await this.channel.assertExchange(dlxName, 'direct', { durable: true });

    // Создаем DLQ с опциями
    const dlqOptions = {
      durable: true,
      arguments: {},
    };

    if (this.dlq.ttl) {
      dlqOptions.arguments['x-message-ttl'] = this.dlq.ttl;
    }

    await this.channel.assertQueue(dlqName, dlqOptions);

    // Привязываем DLQ к DLX
    await this.channel.bindQueue(dlqName, dlxName, queue);
  }

  /**
   * Отправить сообщение в DLQ
   * @private
   */
  async _sendToDlq(queue, originalMessage, error) {
    if (!this.dlq.enabled) {
      return;
    }

    try {
      await this._ensureDlq(queue);

      const dlxName = this.dlq.exchange;

      // Используем оригинальный контент сообщения
      const messageBuffer = originalMessage.content;

      // Добавляем метаданные об ошибке в заголовки
      const headers = originalMessage.properties.headers || {};
      const options = {
        persistent: true,
        headers: {
          ...headers,
          'x-original-queue': queue,
          'x-failed-reason': error.message || 'Unknown error',
          'x-failed-at': new Date().toISOString(),
          'x-retry-count': this._getRetryCount(originalMessage),
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

      const correlationId = this._getCorrelationId(originalMessage, {});
      await this.channel.publish(dlxName, queue, messageBuffer, options);
      this.metrics.consume.sentToDlq++;

      this.logger.warn(
        {
          queue,
          correlationId,
          dlq: this._getDlqName(queue),
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
   * Получить количество попыток обработки из заголовков сообщения
   * @private
   */
  _getRetryCount(msg) {
    const headers = msg.properties.headers || {};
    return headers['x-retry-count'] || 0;
  }

  /**
   * Увеличить счетчик попыток в заголовках сообщения
   * @private
   */
  _incrementRetryCount(msg) {
    const headers = msg.properties.headers || {};
    headers['x-retry-count'] = (headers['x-retry-count'] || 0) + 1;
    return headers;
  }

  // ==================== PUBLISHER ====================

  /**
   * Отправить сообщение в очередь
   * @param {string} queue - Название очереди
   * @param {string|Buffer|Object} message - Сообщение для отправки
   * @param {Object} options - Опции отправки (persistent, expiration, priority и т.д.)
   * @returns {Promise<boolean>}
   */
  async publish(queue, message, options = {}) {
    const correlationId = this._getCorrelationId(null, options);
    const startTime = Date.now();

    try {
      const messageBuffer = Buffer.isBuffer(message)
        ? message
        : typeof message === 'string'
          ? Buffer.from(message)
          : Buffer.from(JSON.stringify(message));

      const defaultOptions = {
        persistent: true,
        headers: {
          ...options.headers,
          'x-correlation-id': correlationId,
        },
        ...options,
      };

      const publishOperation = async () => {
        await this._ensureConnection();
        return this.channel.sendToQueue(queue, messageBuffer, defaultOptions);
      };

      let result;

      if (this.publishRetry.enabled && options.retry !== false) {
        result = await this._retryOperation(publishOperation, this.publishRetry, 'publish');
      } else {
        result = await publishOperation();
      }

      const duration = (Date.now() - startTime) / 1000;

      // Обновляем метрики публикации
      this.metrics.publish.totalPublished++;
      const queueCount = this.metrics.publish.publishedByQueue.get(queue) || 0;
      this.metrics.publish.publishedByQueue.set(queue, queueCount + 1);
      this.metrics.publish.totalBytesPublished += messageBuffer.length;

      // Вызываем hook для интеграции с внешними системами
      if (this.hooks.onPublish) {
        try {
          this.hooks.onPublish({
            queue,
            exchange: '',
            messageSize: messageBuffer.length,
            duration,
            correlationId,
          });
        } catch (hookError) {
          this.logger.warn({ err: hookError }, 'Error in onPublish hook');
        }
      }

      this.logger.debug(
        {
          queue,
          correlationId,
          messageSize: messageBuffer.length,
        },
        'Message published'
      );

      return result;
    } catch (error) {
      this.metrics.publish.publishErrors++;

      // Вызываем hook для ошибок
      if (this.hooks.onError) {
        try {
          this.hooks.onError({ type: 'publish', error, queue, exchange: '', correlationId });
        } catch (hookError) {
          this.logger.warn({ err: hookError }, 'Error in onError hook');
        }
      }

      this.logger.error(
        {
          err: error,
          queue,
          correlationId,
        },
        'Failed to publish message'
      );

      throw error;
    }
  }

  /**
   * Отправить сообщение через exchange
   * @param {string} exchange - Название exchange
   * @param {string} routingKey - Routing key
   * @param {string|Buffer|Object} message - Сообщение для отправки
   * @param {Object} options - Опции отправки
   * @returns {Promise<boolean>}
   */
  async publishToExchange(exchange, routingKey, message, options = {}) {
    const correlationId = this._getCorrelationId(null, options);
    const startTime = Date.now();

    try {
      const messageBuffer = Buffer.isBuffer(message)
        ? message
        : typeof message === 'string'
          ? Buffer.from(message)
          : Buffer.from(JSON.stringify(message));

      const defaultOptions = {
        persistent: true,
        headers: {
          ...options.headers,
          'x-correlation-id': correlationId,
        },
        ...options,
      };

      const publishOperation = async () => {
        await this._ensureConnection();
        return this.channel.publish(exchange, routingKey, messageBuffer, defaultOptions);
      };

      let result;

      if (this.publishRetry.enabled && options.retry !== false) {
        result = await this._retryOperation(publishOperation, this.publishRetry, 'publish');
      } else {
        result = await publishOperation();
      }

      const duration = (Date.now() - startTime) / 1000;

      // Обновляем метрики публикации
      this.metrics.publish.totalPublished++;
      const exchangeCount = this.metrics.publish.publishedByExchange.get(exchange) || 0;
      this.metrics.publish.publishedByExchange.set(exchange, exchangeCount + 1);
      this.metrics.publish.totalBytesPublished += messageBuffer.length;

      // Вызываем hook для интеграции с внешними системами
      if (this.hooks.onPublish) {
        try {
          this.hooks.onPublish({
            queue: '',
            exchange,
            routingKey,
            messageSize: messageBuffer.length,
            duration,
            correlationId,
          });
        } catch (hookError) {
          this.logger.warn({ err: hookError }, 'Error in onPublish hook');
        }
      }

      this.logger.debug(
        {
          exchange,
          routingKey,
          correlationId,
          messageSize: messageBuffer.length,
        },
        'Message published to exchange'
      );

      return result;
    } catch (error) {
      this.metrics.publish.publishErrors++;

      // Вызываем hook для ошибок
      if (this.hooks.onError) {
        try {
          this.hooks.onError({
            type: 'publish',
            error,
            queue: '',
            exchange,
            routingKey,
            correlationId,
          });
        } catch (hookError) {
          this.logger.warn({ err: hookError }, 'Error in onError hook');
        }
      }

      this.logger.error(
        {
          err: error,
          exchange,
          routingKey,
          correlationId,
        },
        'Failed to publish message to exchange'
      );

      throw error;
    }
  }

  // ==================== CONSUMER ====================

  /**
   * Слушать очередь
   * @param {string} queue - Название очереди
   * @param {Function} handler - Обработчик сообщений (msg) => {}
   * @param {Object} options - Опции consumer (noAck, prefetch и т.д.)
   * @returns {Promise<string>} - Consumer tag
   */
  async consume(queue, handler, options = {}) {
    await this._ensureConnection();

    // Если уже есть consumer для этой очереди, останавливаем его
    if (this.consumers.has(queue)) {
      await this.stopConsuming(queue);
    }

    const defaultOptions = {
      noAck: false,
      ...options,
    };

    // Устанавливаем prefetch если указан
    if (options.prefetch !== undefined) {
      await this.channel.prefetch(options.prefetch);
    }

    const result = await this.channel.consume(
      queue,
      async (msg) => {
        if (!msg) {
          return;
        }

        const startTime = Date.now();
        const retryCount = this._getRetryCount(msg);
        const correlationId = this._getCorrelationId(msg, {});
        const maxRetries =
          options.maxRetries !== undefined
            ? options.maxRetries
            : this.consumeRetry.enabled
              ? this.consumeRetry.maxAttempts
              : 0;
        const useRetry =
          options.retry !== false && this.consumeRetry.enabled && retryCount < maxRetries;

        try {
          // Обработка с retry если включено
          if (useRetry && retryCount > 0) {
            const delay = this._calculateRetryDelay(
              retryCount,
              this.consumeRetry.initialDelay,
              this.consumeRetry.maxDelay,
              this.consumeRetry.multiplier
            );
            this.logger.debug(
              {
                queue,
                correlationId,
                retryCount,
                delay,
              },
              'Retrying message processing'
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          this.logger.debug(
            {
              queue,
              correlationId,
              retryCount,
            },
            'Processing message'
          );

          await handler(msg);

          // Обновляем метрики успешной обработки
          const processingTime = Date.now() - startTime;
          const processingTimeSeconds = processingTime / 1000;
          this.metrics.consume.totalConsumed++;
          const queueCount = this.metrics.consume.consumedByQueue.get(queue) || 0;
          this.metrics.consume.consumedByQueue.set(queue, queueCount + 1);
          this.metrics.consume.totalProcessingTime += processingTime;

          // Вызываем hook для интеграции с внешними системами
          if (this.hooks.onConsume) {
            try {
              this.hooks.onConsume({
                queue,
                processingTime: processingTimeSeconds,
                correlationId,
                retryCount,
              });
            } catch (hookError) {
              this.logger.warn({ err: hookError }, 'Error in onConsume hook');
            }
          }

          if (
            this.metrics.consume.minProcessingTime === null ||
            processingTime < this.metrics.consume.minProcessingTime
          ) {
            this.metrics.consume.minProcessingTime = processingTime;
          }
          if (
            this.metrics.consume.maxProcessingTime === null ||
            processingTime > this.metrics.consume.maxProcessingTime
          ) {
            this.metrics.consume.maxProcessingTime = processingTime;
          }

          this.logger.debug(
            {
              queue,
              correlationId,
              processingTime,
            },
            'Message processed successfully'
          );

          // Если noAck=false, подтверждаем сообщение
          if (!defaultOptions.noAck) {
            this.channel.ack(msg);
          }
        } catch (error) {
          this.logger.error(
            {
              err: error,
              queue,
              correlationId,
              attempt: retryCount + 1,
            },
            'Error processing message'
          );

          // Обновляем метрики ошибок
          this.metrics.consume.consumeErrors++;

          // Вызываем hook для ошибок
          if (this.hooks.onError) {
            try {
              this.hooks.onError({ type: 'consume', error, queue, correlationId, retryCount });
            } catch (hookError) {
              this.logger.warn({ err: hookError }, 'Error in onError hook');
            }
          }

          if (!defaultOptions.noAck) {
            // Если есть еще попытки и retry включен, отправляем сообщение обратно в очередь с увеличенным счетчиком
            if (useRetry && retryCount < maxRetries) {
              const newHeaders = this._incrementRetryCount(msg);

              // Отправляем сообщение обратно в очередь с обновленными заголовками
              const messageBuffer = msg.content;
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

              try {
                await this.channel.sendToQueue(queue, messageBuffer, republishOptions);
                this.channel.ack(msg); // Подтверждаем оригинальное сообщение
                this.metrics.consume.consumeRetries++;

                this.logger.info(
                  {
                    queue,
                    correlationId,
                    retryCount: retryCount + 1,
                  },
                  'Message requeued for retry'
                );

                return;
              } catch (republishError) {
                this.logger.error(
                  {
                    err: republishError,
                    queue,
                    correlationId,
                  },
                  'Failed to republish message'
                );

                // Если не удалось отправить обратно, отправляем в DLQ или отклоняем
              }
            }

            // Если попытки исчерпаны или retry отключен, отправляем в DLQ или отклоняем
            const shouldSendToDlq = this.dlq.enabled && retryCount >= maxRetries;
            const requeue = !shouldSendToDlq && options.requeue !== false;

            if (shouldSendToDlq) {
              await this._sendToDlq(queue, msg, error);
              this.channel.ack(msg); // Подтверждаем после отправки в DLQ

              this.logger.warn(
                {
                  queue,
                  correlationId,
                  retryCount,
                },
                'Message sent to DLQ'
              );
            } else {
              if (requeue) {
                this.metrics.consume.requeued++;
              }
              this.channel.nack(msg, false, requeue);

              this.logger.warn(
                {
                  queue,
                  correlationId,
                  requeue,
                },
                'Message nacked'
              );
            }
          }
        }
      },
      defaultOptions
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
   * Остановить consumer для очереди
   * @param {string} queue - Название очереди
   * @returns {Promise<void>}
   */
  async stopConsuming(queue) {
    const consumer = this.consumers.get(queue);
    if (!consumer) {
      return;
    }

    if (this.channel) {
      try {
        await this.channel.cancel(consumer.consumerTag);

        this.logger.info(
          {
            queue,
            consumerTag: consumer.consumerTag,
          },
          'Consumer stopped'
        );
      } catch (error) {
        this.logger.error(
          {
            err: error,
            queue,
            consumerTag: consumer.consumerTag,
          },
          'Error canceling consumer'
        );
      }
    }

    this.consumers.delete(queue);
  }

  // ==================== QUEUE MANAGEMENT ====================

  /**
   * Создать/проверить очередь
   * @param {string} queue - Название очереди
   * @param {Object} options - Опции очереди (durable, exclusive, autoDelete и т.д.)
   * @returns {Promise<Object>} - Информация о очереди
   */
  async assertQueue(queue, options = {}) {
    await this._ensureConnection();

    const defaultOptions = {
      durable: true,
      ...options,
    };

    // Если DLQ включен и не указано явно отключить его, настраиваем DLQ
    if (this.dlq.enabled && options.dlq !== false) {
      await this._ensureDlq(queue);

      // Настраиваем очередь с аргументами для DLQ
      if (!defaultOptions.arguments) {
        defaultOptions.arguments = {};
      }

      const dlxName = this.dlq.exchange;

      // Устанавливаем dead-letter-exchange и dead-letter-routing-key
      defaultOptions.arguments['x-dead-letter-exchange'] = dlxName;
      defaultOptions.arguments['x-dead-letter-routing-key'] = queue;
    }

    const result = await this.channel.assertQueue(queue, defaultOptions);
    this.metrics.queue.totalAsserted++;
    return result;
  }

  /**
   * Удалить очередь
   * @param {string} queue - Название очереди
   * @param {Object} options - Опции удаления (ifUnused, ifEmpty)
   * @returns {Promise<Object>}
   */
  async deleteQueue(queue, options = {}) {
    await this._ensureConnection();

    // Останавливаем consumer если есть
    if (this.consumers.has(queue)) {
      await this.stopConsuming(queue);
    }

    const result = await this.channel.deleteQueue(queue, options);
    this.metrics.queue.totalDeleted++;
    return result;
  }

  /**
   * Очистить очередь (удалить все сообщения)
   * @param {string} queue - Название очереди
   * @returns {Promise<Object>}
   */
  async purgeQueue(queue) {
    await this._ensureConnection();
    const result = await this.channel.purgeQueue(queue);
    this.metrics.queue.totalPurged++;
    return result;
  }

  /**
   * Получить информацию о очереди
   * @param {string} queue - Название очереди
   * @returns {Promise<Object>} - { queue, messageCount, consumerCount }
   */
  async getQueueInfo(queue) {
    await this._ensureConnection();
    return this.channel.checkQueue(queue);
  }

  // ==================== EXCHANGE MANAGEMENT ====================

  /**
   * Создать/проверить exchange
   * @param {string} exchange - Название exchange
   * @param {string} type - Тип exchange (direct, topic, fanout, headers)
   * @param {Object} options - Опции exchange (durable, autoDelete и т.д.)
   * @returns {Promise<Object>}
   */
  async assertExchange(exchange, type, options = {}) {
    await this._ensureConnection();

    const defaultOptions = {
      durable: true,
      ...options,
    };

    const result = await this.channel.assertExchange(exchange, type, defaultOptions);
    this.metrics.exchange.totalAsserted++;
    return result;
  }

  /**
   * Удалить exchange
   * @param {string} exchange - Название exchange
   * @param {Object} options - Опции удаления (ifUnused)
   * @returns {Promise<void>}
   */
  async deleteExchange(exchange, options = {}) {
    await this._ensureConnection();
    const result = await this.channel.deleteExchange(exchange, options);
    this.metrics.exchange.totalDeleted++;
    return result;
  }

  /**
   * Привязать очередь к exchange
   * @param {string} queue - Название очереди
   * @param {string} exchange - Название exchange
   * @param {string} routingKey - Routing key
   * @param {Object} args - Дополнительные аргументы для binding
   * @returns {Promise<Object>}
   */
  async bindQueue(queue, exchange, routingKey, args = {}) {
    await this._ensureConnection();
    const result = await this.channel.bindQueue(queue, exchange, routingKey, args);
    this.metrics.exchange.totalBindings++;
    return result;
  }

  /**
   * Отвязать очередь от exchange
   * @param {string} queue - Название очереди
   * @param {string} exchange - Название exchange
   * @param {string} routingKey - Routing key
   * @param {Object} args - Дополнительные аргументы для unbinding
   * @returns {Promise<void>}
   */
  async unbindQueue(queue, exchange, routingKey, args = {}) {
    await this._ensureConnection();
    return this.channel.unbindQueue(queue, exchange, routingKey, args);
  }

  /**
   * Получить информацию о exchange
   * @param {string} exchange - Название exchange
   * @returns {Promise<Object>}
   */
  async getExchangeInfo(exchange) {
    await this._ensureConnection();
    return this.channel.checkExchange(exchange);
  }

  // ==================== DEAD LETTER QUEUE ====================

  /**
   * Получить имя DLQ для очереди
   * @param {string} queue - Название очереди
   * @returns {string} Имя DLQ
   */
  getDlqName(queue) {
    return this._getDlqName(queue);
  }

  /**
   * Создать/проверить DLQ для очереди
   * @param {string} queue - Название очереди
   * @returns {Promise<Object>} Информация о DLQ
   */
  async assertDlq(queue) {
    await this._ensureDlq(queue);
    const dlqName = this._getDlqName(queue);
    return this.getQueueInfo(dlqName);
  }

  /**
   * Получить информацию о DLQ для очереди
   * @param {string} queue - Название очереди
   * @returns {Promise<Object>} Информация о DLQ
   */
  async getDlqInfo(queue) {
    const dlqName = this._getDlqName(queue);
    return this.getQueueInfo(dlqName);
  }

  /**
   * Очистить DLQ для очереди
   * @param {string} queue - Название очереди
   * @returns {Promise<Object>}
   */
  async purgeDlq(queue) {
    const dlqName = this._getDlqName(queue);
    return this.purgeQueue(dlqName);
  }

  /**
   * Удалить DLQ для очереди
   * @param {string} queue - Название очереди
   * @param {Object} options - Опции удаления
   * @returns {Promise<Object>}
   */
  async deleteDlq(queue, options = {}) {
    const dlqName = this._getDlqName(queue);
    return this.deleteQueue(dlqName, options);
  }

  // ==================== METRICS ====================

  /**
   * Получить все метрики
   * @returns {Object} Объект с метриками
   */
  getMetrics() {
    // Конвертируем Maps в объекты для удобства
    const publishedByQueue = {};
    this.metrics.publish.publishedByQueue.forEach((count, queue) => {
      publishedByQueue[queue] = count;
    });

    const publishedByExchange = {};
    this.metrics.publish.publishedByExchange.forEach((count, exchange) => {
      publishedByExchange[exchange] = count;
    });

    const consumedByQueue = {};
    this.metrics.consume.consumedByQueue.forEach((count, queue) => {
      consumedByQueue[queue] = count;
    });

    const avgProcessingTime =
      this.metrics.consume.totalConsumed > 0
        ? this.metrics.consume.totalProcessingTime / this.metrics.consume.totalConsumed
        : null;

    return {
      connection: {
        ...this.metrics.connection,
        uptime:
          this.metrics.connection.lastConnectionTime &&
          this.metrics.connection.lastDisconnectionTime
            ? this.metrics.connection.lastDisconnectionTime -
              this.metrics.connection.lastConnectionTime
            : this.metrics.connection.lastConnectionTime
              ? Date.now() - this.metrics.connection.lastConnectionTime
              : null,
      },
      publish: {
        totalPublished: this.metrics.publish.totalPublished,
        publishedByQueue,
        publishedByExchange,
        publishErrors: this.metrics.publish.publishErrors,
        publishRetries: this.metrics.publish.publishRetries,
        totalBytesPublished: this.metrics.publish.totalBytesPublished,
        averageMessageSize:
          this.metrics.publish.totalPublished > 0
            ? this.metrics.publish.totalBytesPublished / this.metrics.publish.totalPublished
            : 0,
      },
      consume: {
        totalConsumed: this.metrics.consume.totalConsumed,
        consumedByQueue,
        consumeErrors: this.metrics.consume.consumeErrors,
        consumeRetries: this.metrics.consume.consumeRetries,
        requeued: this.metrics.consume.requeued,
        sentToDlq: this.metrics.consume.sentToDlq,
        averageProcessingTime: avgProcessingTime,
        minProcessingTime: this.metrics.consume.minProcessingTime,
        maxProcessingTime: this.metrics.consume.maxProcessingTime,
        errorRate:
          this.metrics.consume.totalConsumed > 0
            ? this.metrics.consume.consumeErrors /
              (this.metrics.consume.totalConsumed + this.metrics.consume.consumeErrors)
            : 0,
      },
      queue: {
        ...this.metrics.queue,
      },
      exchange: {
        ...this.metrics.exchange,
      },
    };
  }

  /**
   * Сбросить все метрики
   */
  resetMetrics() {
    this.metrics.connection.totalConnections = 0;
    this.metrics.connection.totalReconnects = 0;
    this.metrics.connection.connectionErrors = 0;
    this.metrics.connection.lastConnectionTime = null;
    this.metrics.connection.lastDisconnectionTime = null;

    this.metrics.publish.totalPublished = 0;
    this.metrics.publish.publishedByQueue.clear();
    this.metrics.publish.publishedByExchange.clear();
    this.metrics.publish.publishErrors = 0;
    this.metrics.publish.publishRetries = 0;
    this.metrics.publish.totalBytesPublished = 0;

    this.metrics.consume.totalConsumed = 0;
    this.metrics.consume.consumedByQueue.clear();
    this.metrics.consume.consumeErrors = 0;
    this.metrics.consume.consumeRetries = 0;
    this.metrics.consume.requeued = 0;
    this.metrics.consume.sentToDlq = 0;
    this.metrics.consume.totalProcessingTime = 0;
    this.metrics.consume.minProcessingTime = null;
    this.metrics.consume.maxProcessingTime = null;

    this.metrics.queue.totalAsserted = 0;
    this.metrics.queue.totalDeleted = 0;
    this.metrics.queue.totalPurged = 0;

    this.metrics.exchange.totalAsserted = 0;
    this.metrics.exchange.totalDeleted = 0;
    this.metrics.exchange.totalBindings = 0;
  }
}

module.exports = RabbitMQClient;
