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

    // Глобальный обработчик uncaughtException для heartbeat timeout
    this._uncaughtExceptionHandler = null;
    this._isUncaughtHandlerRegistered = false;
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

    try {
      await this._connect();
      // Успешное подключение
      return;
    } catch (error) {
      // Если autoReconnect включен и это RabbitMQ ошибка
      if (this.options.autoReconnect && this._isRabbitMQError(error)) {
        // Если waitForConnection: true, ждем первого успешного подключения
        if (this.options.waitForConnection !== false) {
          this.logger.info('Initial connection failed, waiting for reconnect...');
          return this._waitForReconnect();
        } else {
          // Если waitForConnection: false, возвращаемся сразу (реконнект в фоне)
          this.logger.warn({ err: error }, 'Initial connection failed, reconnect scheduled in background');
          return;
        }
      }
      // Если autoReconnect выключен или это не RabbitMQ ошибка - пробрасываем
      throw error;
    }
  }

  /**
   * Ожидание успешного переподключения
   */
  async _waitForReconnect() {
    this.logger.debug('Waiting for reconnect...');
    return new Promise((resolve, reject) => {
      // Обработчик успешного подключения
      const onConnected = () => {
        this.logger.debug('Reconnect successful');
        cleanup();
        resolve();
      };

      // Обработчик достижения максимального количества попыток
      const onMaxAttempts = (data) => {
        this.logger.debug({ data }, 'Max reconnect attempts reached');
        cleanup();
        reject(
          new Error(
            `Failed to connect after ${data.attempts} attempts (max: ${data.maxAttempts})`
          )
        );
      };

      // Обработчик shutdown
      const onShutdown = () => {
        this.logger.debug('Connection manager shutting down');
        cleanup();
        reject(new Error('Connection manager is shutting down'));
      };

      // Cleanup listeners
      const cleanup = () => {
        this.removeListener('connected', onConnected);
        this.removeListener('reconnect', onConnected);
        this.removeListener('reconnect-max-attempts-reached', onMaxAttempts);
        this.removeListener('close', onShutdown);
      };

      // Регистрируем обработчики
      this.once('connected', onConnected);
      this.once('reconnect', onConnected);
      this.once('reconnect-max-attempts-reached', onMaxAttempts);
      this.once('close', onShutdown);

      this.logger.debug('Listeners registered, waiting...');
    });
  }

  /**
   * Внутренний метод подключения
   */
  async _connect() {
    try {
      // Очистка старого соединения
      await this._closeOldConnection();

      this.logger.info('Connecting to RabbitMQ');

      // Регистрируем глобальный обработчик для heartbeat timeout
      this._registerUncaughtExceptionHandler();

      // Создание нового соединения с обработкой ошибок
      let connectionError = null;
      try {
        this.connection = await amqp.connect(this.connectionString);
      } catch (error) {
        connectionError = error;
        if (this._isRabbitMQError(error)) {
          this.logger.warn({ err: error }, 'Connection error during connect, will retry');
        } else {
          throw error;
        }
      }

      // Если была ошибка подключения, планируем reconnect
      if (connectionError) {
        this.connection = null;
        this.channel = null;
        this.metrics.incrementConnectionErrors();
        this.emit('error', connectionError);

        if (this.options.autoReconnect && !this.isShuttingDown) {
          this._scheduleReconnect();
        }
        // Бросаем ошибку чтобы вызывающий код мог обработать
        throw connectionError;
      }

      // Создание канала с обработкой ошибок
      let channelError = null;
      try {
        this.channel = await this.connection.createChannel();
      } catch (error) {
        channelError = error;
        if (this._isRabbitMQError(error)) {
          this.logger.warn({ err: error }, 'Channel creation error, will retry');
          // Закрываем соединение если канал не создался
          try {
            await this.connection.close();
          } catch (closeErr) {
            // Игнорируем ошибки закрытия
          }
        } else {
          throw error;
        }
      }

      // Если была ошибка создания канала, планируем reconnect
      if (channelError) {
        this.connection = null;
        this.channel = null;
        this.metrics.incrementConnectionErrors();
        this.emit('error', channelError);

        if (this.options.autoReconnect && !this.isShuttingDown) {
          this._scheduleReconnect();
        }
        // Бросаем ошибку чтобы вызывающий код мог обработать
        throw channelError;
      }

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

      // Проверяем, является ли это ошибкой heartbeat timeout
      if (this._isHeartbeatTimeoutError(error)) {
        this.logger.warn({ err: error }, 'Heartbeat timeout during connect, will reconnect');
        this.metrics.incrementConnectionErrors();
        this.emit('error', error);

        if (this.options.autoReconnect && !this.isShuttingDown) {
          this._scheduleReconnect();
        }
        // Бросаем ошибку чтобы вызывающий код мог обработать
        throw error;
      } else if (this._isRabbitMQError(error)) {
        this.metrics.incrementConnectionErrors();
        this.logger.error({ err: error }, 'Failed to connect to RabbitMQ');
        this.emit('error', error);

        if (this.options.autoReconnect && !this.isShuttingDown) {
          this._scheduleReconnect();
        }
        // Бросаем ошибку чтобы вызывающий код мог обработать
        throw error;
      } else {
        // Не RabbitMQ ошибка - пробрасываем дальше
        this.metrics.incrementConnectionErrors();
        this.logger.error({ err: error }, 'Failed to connect to RabbitMQ');
        this.emit('error', error);
        throw error;
      }
    }
  }

  /**
   * Проверить, является ли ошибка связанной с RabbitMQ
   */
  _isRabbitMQError(error) {
    if (!error) return false;

    const message = error.message || error.toString() || '';
    const stack = error.stack || '';

    // Проверяем сообщение об ошибке
    const rabbitMQErrorPatterns = [
      'Heartbeat timeout',
      'Connection closed',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EPIPE',
      'Socket closed',
      'Connection lost',
      'Channel closed',
      'PRECONDITION_FAILED',
      'NOT_FOUND',
      'ACCESS_REFUSED',
      'amqplib',
      'rabbitmq',
    ];

    // Проверяем stack trace на наличие путей к amqplib
    const amqplibPatterns = [
      'amqplib',
      'node_modules/amqplib',
      'connection.js',
      'channel.js',
    ];

    const messageMatch = rabbitMQErrorPatterns.some((pattern) =>
      message.toLowerCase().includes(pattern.toLowerCase())
    );
    const stackMatch = amqplibPatterns.some((pattern) =>
      stack.toLowerCase().includes(pattern.toLowerCase())
    );

    // Проверяем код ошибки напрямую
    const codeMatch =
      error.code &&
      (error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'EPIPE');

    // Проверяем AggregateError (Node.js может обернуть множественные ошибки подключения)
    let aggregateMatch = false;
    if (error.errors && Array.isArray(error.errors)) {
      aggregateMatch = error.errors.some((err) => this._isRabbitMQError(err));
    }

    return messageMatch || stackMatch || codeMatch || aggregateMatch;
  }

  /**
   * Проверить, является ли ошибка heartbeat timeout
   */
  _isHeartbeatTimeoutError(error) {
    if (!error) return false;

    const message = error.message || error.toString() || '';
    const stack = error.stack || '';

    return (
      message.toLowerCase().includes('heartbeat timeout') ||
      message.toLowerCase().includes('heartbeat') ||
      stack.toLowerCase().includes('heartbeat')
    );
  }

  /**
   * Обработать heartbeat timeout ошибку
   */
  _handleHeartbeatTimeout(error) {
    if (this.isShuttingDown) {
      return;
    }

    // Помечаем соединение как неактивное
    if (this.connection) {
      this.connection = null;
      this.channel = null;
      this.metrics.recordDisconnection();
    }

    this.logger.warn({ err: error }, 'Heartbeat timeout detected, initiating reconnect');

    // Эмитим событие для внешних обработчиков
    this.emit('error', error);
    this.emit('disconnected');

    // Запускаем переподключение
    if (this.options.autoReconnect && !this.isShuttingDown && !this.reconnectTimer) {
      this._scheduleReconnect();
    }
  }

  /**
   * Регистрировать глобальный обработчик uncaughtException для heartbeat timeout
   */
  _registerUncaughtExceptionHandler() {
    if (this._isUncaughtHandlerRegistered) {
      return;
    }

    // Проверяем, не зарегистрирован ли уже обработчик другим экземпляром
    const existingHandler = process.listeners('uncaughtException').find(
      (handler) => handler._isRabbitMQHandler
    );

    if (existingHandler) {
      // Обработчик уже зарегистрирован другим экземпляром
      this._isUncaughtHandlerRegistered = true;
      this.logger.debug('Global uncaughtException handler already registered by another instance');
      return;
    }

    // Создаем новый обработчик
    this._uncaughtExceptionHandler = (error) => {
      // Проверяем, связана ли ошибка с RabbitMQ
      if (!this._isRabbitMQError(error)) {
        // Не RabbitMQ ошибка - не обрабатываем, позволяем другим обработчикам обработать
        return;
      }

      // Проверяем, является ли это heartbeat timeout
      if (this._isHeartbeatTimeoutError(error)) {
        // Обрабатываем heartbeat timeout
        this._handleHeartbeatTimeout(error);
        // НЕ пробрасываем ошибку дальше - предотвращаем падение приложения
        // Это важно, так как heartbeat timeout - это временная проблема подключения
        return;
      }

      // Другие RabbitMQ ошибки - логируем и пытаемся переподключиться
      if (this.connection && !this.isShuttingDown) {
        this.logger.warn(
          { err: error },
          'Uncaught RabbitMQ error detected, will attempt reconnect'
        );
        this.metrics.incrementConnectionErrors();
        this.emit('error', error);

        // Если соединение еще активно, пытаемся переподключиться
        if (this.options.autoReconnect && !this.reconnectTimer) {
          this._handleHeartbeatTimeout(error);
        }
        // НЕ пробрасываем ошибку дальше для RabbitMQ ошибок подключения
        return;
      }
    };

    // Помечаем обработчик для идентификации
    this._uncaughtExceptionHandler._isRabbitMQHandler = true;

    // Регистрируем обработчик в начале списка, чтобы он обрабатывался первым
    // Используем prependListener, чтобы обрабатывать все ошибки, но проверяем дубликаты
    process.prependListener('uncaughtException', this._uncaughtExceptionHandler);
    this._isUncaughtHandlerRegistered = true;

    this.logger.debug('Global uncaughtException handler registered for RabbitMQ errors');
  }

  /**
   * Удалить глобальный обработчик uncaughtException
   */
  _unregisterUncaughtExceptionHandler() {
    if (!this._isUncaughtHandlerRegistered || !this._uncaughtExceptionHandler) {
      return;
    }

    try {
      process.removeListener('uncaughtException', this._uncaughtExceptionHandler);
      this._isUncaughtHandlerRegistered = false;
      this._uncaughtExceptionHandler = null;
      this.logger.debug('Global uncaughtException handler unregistered');
    } catch (error) {
      this.logger.debug({ err: error }, 'Error unregistering uncaughtException handler');
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
      // Проверяем тип ошибки для правильного логирования
      if (this._isHeartbeatTimeoutError(err)) {
        this.logger.warn({ err }, 'RabbitMQ heartbeat timeout error');
        this._handleHeartbeatTimeout(err);
      } else {
        this.logger.error({ err }, 'RabbitMQ connection error');
        this.metrics.incrementConnectionErrors();
        this.emit('error', err);

        if (!this.isShuttingDown && this.options.autoReconnect && !this.reconnectTimer) {
          this._scheduleReconnect();
        }
      }
    });

    // Обработка внутренних ошибок соединения через try-catch в критических местах
    // Перехватываем ошибки, которые могут возникнуть синхронно
    const originalEmit = this.connection.emit.bind(this.connection);
    const self = this;

    // Обертка для перехвата синхронных ошибок
    try {
      // Проверяем доступность внутренних свойств соединения
      if (this.connection.connection && this.connection.connection.on) {
        // Подписываемся на события socket для перехвата heartbeat timeout
        this.connection.connection.on('error', (socketError) => {
          if (self._isHeartbeatTimeoutError(socketError)) {
            self._handleHeartbeatTimeout(socketError);
          } else if (self._isRabbitMQError(socketError)) {
            self.logger.warn({ err: socketError }, 'Socket-level RabbitMQ error');
            self.metrics.incrementConnectionErrors();
            self.emit('error', socketError);

            if (!self.isShuttingDown && self.options.autoReconnect && !self.reconnectTimer) {
              self._scheduleReconnect();
            }
          }
        });
      }
    } catch (error) {
      // Игнорируем ошибки доступа к внутренним свойствам
      this.logger.debug({ err: error }, 'Could not setup socket-level error handler');
    }

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

      // Проверяем, что соединение еще активно перед созданием канала
      if (!this.isConnected()) {
        throw new Error('Connection is not active, cannot recreate channel');
      }

      // Создаем новый канал с обработкой ошибок
      try {
        this.channel = await this.connection.createChannel();
      } catch (error) {
        // Если это heartbeat timeout или другая RabbitMQ ошибка, инициируем полное переподключение
        if (this._isHeartbeatTimeoutError(error) || this._isRabbitMQError(error)) {
          this.logger.warn({ err: error }, 'Channel recreation failed due to connection issue');
          if (this.options.autoReconnect && !this.isShuttingDown) {
            await this._closeOldConnection();
            this._scheduleReconnect();
          }
          throw error;
        }
        throw error;
      }

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

    // Удаляем глобальный обработчик uncaughtException
    this._unregisterUncaughtExceptionHandler();

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
