const amqp = require('amqplib');
const EventEmitter = require('events');
const RetryManager = require('./RetryManager');

/**
 * ConnectionManager - Управление подключением к RabbitMQ с auto-reconnect
 */
class ConnectionManager extends EventEmitter {
  constructor(connectionString, options, logger, metrics) {
    super();

    this.connectionString = connectionString;
    this.options = options;
    this.logger = logger;
    this.metrics = metrics;

    this.connection = null;
    this.channel = null;
    this.isShuttingDown = false;

    // Reconnect state
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  /**
   * Подключиться к RabbitMQ
   */
  async connect() {
    if (this.isShuttingDown) {
      throw new Error('Connection manager is shutting down');
    }

    if (this.isConnected()) {
      return;
    }

    return this._connect();
  }

  /**
   * Внутренний метод подключения
   */
  async _connect() {
    try {
      // Очистка старого соединения
      await this._closeOldConnection();

      this.logger.info('Connecting to RabbitMQ');

      // Создание нового соединения
      this.connection = await amqp.connect(this.connectionString);
      this.channel = await this.connection.createChannel();

      // Настройка обработчиков событий
      this._setupEventHandlers();

      // Успешное подключение
      const wasReconnect = this.reconnectAttempts > 0;
      this.reconnectAttempts = 0;

      this.metrics.incrementConnections();

      if (wasReconnect) {
        this.metrics.incrementReconnects();
        this.logger.info('Reconnected to RabbitMQ');
        this.emit('reconnect');
      } else {
        this.logger.info('Connected to RabbitMQ');
        this.emit('connected');
      }

      this.emit('ready');

      // Hook для внешних систем
      this._callHook('onConnectionChange', { connected: true, wasReconnect });
    } catch (error) {
      this.connection = null;
      this.channel = null;

      this.metrics.incrementConnectionErrors();
      this.logger.error({ err: error }, 'Failed to connect to RabbitMQ');

      this.emit('error', error);

      // Планируем reconnect
      if (this.options.autoReconnect && !this.isShuttingDown) {
        this._scheduleReconnect();
      }

      throw error;
    }
  }

  /**
   * Закрыть старое соединение
   */
  async _closeOldConnection() {
    if (!this.connection) return;

    try {
      if (this.channel) {
        await this.channel.close();
      }
      await this.connection.close();
    } catch (err) {
      this.logger.debug({ err }, 'Error closing old connection');
    } finally {
      this.connection = null;
      this.channel = null;
    }
  }

  /**
   * Настройка обработчиков событий соединения
   */
  _setupEventHandlers() {
    // Connection events
    this.connection.on('close', () => {
      if (this.connection) {
        this.connection = null;
        this.channel = null;
        this.metrics.recordDisconnection();

        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ connection closed');
          this.emit('disconnected');
          this._callHook('onConnectionChange', { connected: false });
        }
      }

      if (!this.isShuttingDown && this.options.autoReconnect && !this.reconnectTimer) {
        this._scheduleReconnect();
      }
    });

    this.connection.on('error', (err) => {
      this.logger.error({ err }, 'RabbitMQ connection error');
      this.metrics.incrementConnectionErrors();
      this.emit('error', err);

      if (!this.isShuttingDown && this.options.autoReconnect && !this.reconnectTimer) {
        this._scheduleReconnect();
      }
    });

    // Channel events
    this.channel.on('error', (err) => {
      this.logger.error({ err }, 'RabbitMQ channel error');
      this.emit('channel-error', err);

      // Если канал закрылся из-за PRECONDITION_FAILED или других ошибок,
      // пытаемся пересоздать его
      if (err.code === 406 || err.message.includes('PRECONDITION_FAILED')) {
        this.logger.warn('Channel closed due to PRECONDITION_FAILED, recreating...');
        this._recreateChannel().catch((recreateErr) => {
          this.logger.error({ err: recreateErr }, 'Failed to recreate channel');
        });
      }
    });

    this.channel.on('close', () => {
      this.logger.warn('RabbitMQ channel closed');
      this.emit('channel-close');

      // Пересоздаем канал если соединение активно
      if (this.connection && !this.isShuttingDown) {
        this.logger.info('Attempting to recreate channel...');
        this._recreateChannel().catch((err) => {
          this.logger.error({ err }, 'Failed to recreate channel after close');
        });
      }
    });

    this.channel.on('return', (msg) => {
      this.emit('message-returned', msg);
    });

    this.channel.on('drain', () => {
      this.emit('channel-drain');
    });
  }

  /**
   * Пересоздать канал (после ошибки PRECONDITION_FAILED и т.д.)
   */
  async _recreateChannel() {
    if (this.isShuttingDown || !this.connection) {
      return;
    }

    try {
      this.logger.info('Recreating channel...');

      // Закрываем старый канал если он еще открыт
      if (this.channel) {
        try {
          await this.channel.close();
        } catch (err) {
          // Игнорируем ошибки при закрытии
        }
      }

      // Создаем новый канал
      this.channel = await this.connection.createChannel();

      // Настраиваем обработчики событий
      this._setupEventHandlers();

      this.logger.info('Channel recreated successfully');
      this.emit('channel-recreated');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to recreate channel');
      this.channel = null;

      // Если не можем пересоздать канал, пробуем переподключиться полностью
      if (this.options.autoReconnect && !this.isShuttingDown) {
        this.logger.warn('Will attempt full reconnection');
        await this._closeOldConnection();
        this._scheduleReconnect();
      }

      throw error;
    }
  }

  /**
   * Планирование переподключения
   */
  _scheduleReconnect() {
    if (this.isShuttingDown || this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.logger.error(
        {
          attempts: this.reconnectAttempts,
          maxAttempts: this.options.maxReconnectAttempts,
        },
        'Max reconnect attempts reached'
      );
      this.emit('reconnect-max-attempts-reached', {
        attempts: this.reconnectAttempts,
        maxAttempts: this.options.maxReconnectAttempts,
      });
      return;
    }

    this.reconnectAttempts++;

    const delay = RetryManager.calculateDelay(
      this.reconnectAttempts,
      this.options.initialReconnectDelay,
      this.options.maxReconnectDelay,
      this.options.reconnectMultiplier
    );

    this.logger.info({ attempt: this.reconnectAttempts, delay }, 'Scheduling reconnect');

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.isShuttingDown) {
        return;
      }

      try {
        await this._connect();
      } catch (error) {
        this.logger.error({ err: error, attempt: this.reconnectAttempts }, 'Reconnect failed');

        this.emit('reconnect-failed', {
          attempt: this.reconnectAttempts,
          error,
        });

        if (!this.isShuttingDown) {
          this._scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * Проверка подключения
   */
  isConnected() {
    if (!this.connection || !this.channel) {
      return false;
    }

    try {
      const socket = this.connection.connection;
      if (!socket || socket.destroyed) {
        return false;
      }

      return socket.readyState !== 'closed' && socket.readyState !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Получить канал
   */
  getChannel() {
    if (!this.channel) {
      throw new Error('Channel is not available');
    }
    return this.channel;
  }

  /**
   * Убедиться что есть подключение
   */
  async ensureConnection() {
    if (!this.isConnected()) {
      await this.connect();
    }

    if (!this.channel) {
      throw new Error('Channel is not available');
    }
  }

  /**
   * Закрыть соединение
   */
  async close() {
    if (this.isShuttingDown) {
      return;
    }

    this.logger.info('Closing connection');
    this.isShuttingDown = true;

    // Отменяем reconnect таймер
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

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
      this.logger.debug({ err: error }, 'Error closing connection');
      this.connection = null;
      this.channel = null;
    }

    this.emit('close');
  }

  /**
   * Вызвать hook если он определен
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

  /**
   * Получить информацию о подключении
   */
  getConnectionInfo() {
    return {
      connected: this.isConnected(),
      connectionString: this.connectionString,
      reconnectAttempts: this.reconnectAttempts,
      autoReconnect: this.options.autoReconnect,
      maxReconnectAttempts: this.options.maxReconnectAttempts,
    };
  }
}

module.exports = ConnectionManager;
