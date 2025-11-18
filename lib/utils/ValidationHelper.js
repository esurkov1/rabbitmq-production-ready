/**
 * ValidationHelper - централизованная валидация конфигурации
 */
class ValidationHelper {
  /**
   * Validate connection string
   */
  static validateConnectionString(connectionString) {
    if (typeof connectionString !== 'string' || connectionString.trim() === '') {
      throw new Error('connectionString must be a non-empty string');
    }

    // Validate AMQP URL format
    if (!connectionString.startsWith('amqp://') && !connectionString.startsWith('amqps://')) {
      throw new Error('connectionString must be a valid AMQP URL');
    }
  }

  /**
   * Validate number
   */
  static validateNumber(value, name, options = {}) {
    if (value === undefined && options.allowUndefined) {
      return;
    }

    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`${name} must be a number`);
    }

    if (options.min !== undefined && value < options.min) {
      throw new Error(`${name} must be >= ${options.min}`);
    }

    if (options.max !== undefined && value > options.max) {
      throw new Error(`${name} must be <= ${options.max}`);
    }
  }

  /**
   * Validate boolean
   */
  static validateBoolean(value, name, options = {}) {
    if (value === undefined && options.allowUndefined) {
      return;
    }

    if (typeof value !== 'boolean') {
      throw new Error(`${name} must be a boolean`);
    }
  }

  /**
   * Validate string
   */
  static validateString(value, name, options = {}) {
    if (value === undefined && options.allowUndefined) {
      return;
    }

    if (typeof value !== 'string') {
      throw new Error(`${name} must be a string`);
    }

    if (!options.allowEmpty && value.trim() === '') {
      throw new Error(`${name} must be a non-empty string`);
    }
  }

  /**
   * Validate function
   */
  static validateFunction(value, name, options = {}) {
    if (value === undefined && options.allowUndefined) {
      return;
    }

    if (typeof value !== 'function') {
      throw new Error(`${name} must be a function`);
    }
  }

  /**
   * Validate object
   */
  static validateObject(value, name, options = {}) {
    if (value === undefined && options.allowUndefined) {
      return;
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${name} must be an object`);
    }
  }

  /**
   * Validate retry config
   */
  static validateRetryConfig(retryConfig, configName) {
    if (!retryConfig) return;

    if (retryConfig.maxAttempts !== undefined) {
      if (typeof retryConfig.maxAttempts !== 'number' || retryConfig.maxAttempts < 1) {
        throw new Error(`${configName}.maxAttempts must be a positive number`);
      }
    }

    this.validateNumber(retryConfig.initialDelay, `${configName}.initialDelay`, {
      min: 0,
      allowUndefined: true,
    });

    this.validateNumber(retryConfig.maxDelay, `${configName}.maxDelay`, {
      min: 0,
      allowUndefined: true,
    });

    this.validateNumber(retryConfig.multiplier, `${configName}.multiplier`, {
      min: 0.1,
      allowUndefined: true,
    });

    this.validateBoolean(retryConfig.enabled, `${configName}.enabled`, {
      allowUndefined: true,
    });
  }

  /**
   * Validate DLQ config
   */
  static validateDLQConfig(dlqConfig) {
    if (!dlqConfig) return;

    this.validateBoolean(dlqConfig.enabled, 'dlq.enabled', {
      allowUndefined: true,
    });

    this.validateString(dlqConfig.exchange, 'dlq.exchange', {
      allowUndefined: true,
      allowEmpty: false,
    });

    this.validateString(dlqConfig.queuePrefix, 'dlq.queuePrefix', {
      allowUndefined: true,
      allowEmpty: false,
    });

    this.validateString(dlqConfig.suffix, 'dlq.suffix', {
      allowUndefined: true,
      allowEmpty: false,
    });

    this.validateNumber(dlqConfig.maxRetries, 'dlq.maxRetries', {
      min: 0,
      allowUndefined: true,
    });

    this.validateNumber(dlqConfig.ttl, 'dlq.ttl', {
      min: 0,
      allowUndefined: true,
    });

    this.validateBoolean(dlqConfig.persistent, 'dlq.persistent', {
      allowUndefined: true,
    });
  }

  /**
   * Validate hooks config
   */
  static validateHooksConfig(hooks) {
    if (!hooks) return;

    this.validateFunction(hooks.onPublish, 'hooks.onPublish', {
      allowUndefined: true,
    });

    this.validateFunction(hooks.onConsume, 'hooks.onConsume', {
      allowUndefined: true,
    });

    this.validateFunction(hooks.onError, 'hooks.onError', {
      allowUndefined: true,
    });
  }

  /**
   * Validate tracing config
   */
  static validateTracingConfig(tracing) {
    if (!tracing) return;

    this.validateBoolean(tracing.enabled, 'tracing.enabled', {
      allowUndefined: true,
    });

    this.validateString(tracing.headerName, 'tracing.headerName', {
      allowUndefined: true,
      allowEmpty: false,
    });

    this.validateString(tracing.correlationIdHeader, 'tracing.correlationIdHeader', {
      allowUndefined: true,
      allowEmpty: false,
    });

    this.validateFunction(tracing.getTraceContext, 'tracing.getTraceContext', {
      allowUndefined: true,
    });

    this.validateFunction(tracing.setTraceContext, 'tracing.setTraceContext', {
      allowUndefined: true,
    });

    this.validateFunction(tracing.generateTraceId, 'tracing.generateTraceId', {
      allowUndefined: true,
    });

    this.validateFunction(tracing.headerExtractor, 'tracing.headerExtractor', {
      allowUndefined: true,
    });

    this.validateFunction(tracing.headerInjector, 'tracing.headerInjector', {
      allowUndefined: true,
    });
  }

  /**
   * Validate client options
   */
  static validateClientOptions(options) {
    if (!options || typeof options !== 'object') {
      return;
    }

    // Validate reconnect config
    this.validateBoolean(options.autoReconnect, 'autoReconnect', { allowUndefined: true });
    this.validateNumber(options.maxReconnectAttempts, 'maxReconnectAttempts', {
      min: 0,
      allowUndefined: true,
    });
    this.validateNumber(options.initialReconnectDelay, 'initialReconnectDelay', {
      min: 0,
      allowUndefined: true,
    });
    this.validateNumber(options.maxReconnectDelay, 'maxReconnectDelay', {
      min: 0,
      allowUndefined: true,
    });
    this.validateNumber(options.reconnectMultiplier, 'reconnectMultiplier', {
      min: 1,
      allowUndefined: true,
    });

    // Validate shutdown config
    this.validateNumber(options.shutdownTimeout, 'shutdownTimeout', {
      min: 0,
      allowUndefined: true,
    });

    // Validate retry configs
    this.validateRetryConfig(options.publishRetry, 'publishRetry');
    this.validateRetryConfig(options.consumeRetry, 'consumeRetry');

    // Validate DLQ config
    this.validateDLQConfig(options.dlq);

    // Validate serialization
    this.validateFunction(options.serializer, 'serializer', { allowUndefined: true });
    this.validateFunction(options.deserializer, 'deserializer', { allowUndefined: true });

    // Validate tracing config
    this.validateTracingConfig(options.tracing);

    // Validate hooks
    this.validateHooksConfig(options.hooks);

    // Validate correlation ID generator
    this.validateFunction(options.correlationIdGenerator, 'correlationIdGenerator', {
      allowUndefined: true,
    });

    // Validate logger
    this.validateObject(options.logger, 'logger', { allowUndefined: true });

    // Validate logLevel
    this.validateString(options.logLevel, 'logLevel', { allowUndefined: true, allowEmpty: false });

    // Validate registerShutdownHandlers
    this.validateBoolean(options.registerShutdownHandlers, 'registerShutdownHandlers', {
      allowUndefined: true,
    });
  }
}

module.exports = ValidationHelper;
