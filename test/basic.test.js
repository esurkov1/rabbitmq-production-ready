const { test } = require('node:test');
const assert = require('node:assert');
const RabbitMQClient = require('../lib/RabbitMQClient');

// ==================== CONSTRUCTOR & VALIDATION ====================

test('should create client instance', () => {
  const client = new RabbitMQClient('amqp://localhost');
  assert.ok(client instanceof RabbitMQClient);
  assert.strictEqual(typeof client.connect, 'function');
  assert.strictEqual(typeof client.publish, 'function');
  assert.strictEqual(typeof client.consume, 'function');
});

test('should throw on invalid connection string', () => {
  assert.throws(() => {
    new RabbitMQClient('');
  }, /connectionString must be a non-empty string/);

  assert.throws(() => {
    new RabbitMQClient(null);
  }, /connectionString must be a non-empty string/);

  assert.throws(() => {
    new RabbitMQClient('invalid-url');
  }, /connectionString must be a valid AMQP URL/);
});

test('should validate retry config', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      publishRetry: {
        maxAttempts: -1,
      },
    });
  }, /publishRetry\.maxAttempts must be a positive number/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      publishRetry: {
        maxAttempts: 0,
      },
    });
  }, /publishRetry\.maxAttempts must be a positive number/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      consumeRetry: {
        multiplier: 0,
      },
    });
  }, /consumeRetry\.multiplier must be >= 0.1/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      consumeRetry: {
        multiplier: -1,
      },
    });
  }, /consumeRetry\.multiplier must be >= 0.1/);
});

test('should validate DLQ config', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      dlq: {
        exchange: '',
      },
    });
  }, /dlq\.exchange must be a non-empty string/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      dlq: {
        queuePrefix: '',
      },
    });
  }, /dlq\.queuePrefix must be a non-empty string/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      dlq: {
        ttl: -1,
      },
    });
  }, /dlq\.ttl must be >= 0/);
});

test('should validate tracing config', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      tracing: {
        enabled: 'not-boolean',
      },
    });
  }, /tracing\.enabled must be a boolean/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      tracing: {
        headerName: '',
      },
    });
  }, /tracing\.headerName must be a non-empty string/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      tracing: {
        getTraceContext: 'not-a-function',
      },
    });
  }, /tracing\.getTraceContext must be a function/);
});

test('should validate serializer and deserializer', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      serializer: 'not-a-function',
    });
  }, /serializer must be a function/);

  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      deserializer: 'not-a-function',
    });
  }, /deserializer must be a function/);
});

// ==================== DEFAULT OPTIONS ====================

test('should have correct default options', () => {
  const client = new RabbitMQClient('amqp://localhost');

  // Auto-reconnect defaults
  assert.strictEqual(client.options.autoReconnect, true);
  assert.strictEqual(client.options.maxReconnectAttempts, Infinity);
  assert.strictEqual(client.options.initialReconnectDelay, 1000);
  assert.strictEqual(client.options.maxReconnectDelay, 30000);
  assert.strictEqual(client.options.reconnectMultiplier, 2);

  // Retry defaults
  assert.strictEqual(client.options.publishRetry.enabled, true);
  assert.strictEqual(client.options.publishRetry.maxAttempts, 3);
  assert.strictEqual(client.options.consumeRetry.enabled, true);
  assert.strictEqual(client.options.consumeRetry.maxAttempts, 3);

  // DLQ defaults
  assert.strictEqual(client.options.dlq.enabled, false);
  assert.strictEqual(client.options.dlq.exchange, 'dlx');
  assert.strictEqual(client.options.dlq.queuePrefix, 'dlq');

  // Shutdown defaults
  assert.strictEqual(client.options.shutdownTimeout, 10000);
});

test('should enable DLQ when explicitly set', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    dlq: {
      enabled: true,
    },
  });
  assert.strictEqual(client.options.dlq.enabled, true);
});

test('should support custom options', () => {
  const customSerializer = (msg) => Buffer.from(JSON.stringify({ custom: msg }));
  const customDeserializer = (buf) => JSON.parse(buf.toString());

  const client = new RabbitMQClient('amqp://localhost', {
    autoReconnect: false,
    maxReconnectAttempts: 5,
    publishRetry: {
      enabled: false,
    },
    serializer: customSerializer,
    deserializer: customDeserializer,
  });

  assert.strictEqual(client.options.autoReconnect, false);
  assert.strictEqual(client.options.maxReconnectAttempts, 5);
  assert.strictEqual(client.options.publishRetry.enabled, false);
  assert.strictEqual(client.publisher.serializer, customSerializer);
  assert.strictEqual(client.consumer.deserializer, customDeserializer);
});

// ==================== CONNECTION INFO ====================

test('should get connection info', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const info = client.getConnectionInfo();

  assert.ok(typeof info === 'object');
  assert.strictEqual(info.connected, false);
  assert.strictEqual(info.connectionString, 'amqp://localhost');
  assert.strictEqual(info.autoReconnect, true);
  assert.strictEqual(info.maxReconnectAttempts, Infinity);
  assert.strictEqual(typeof info.reconnectAttempts, 'number');
});

test('should report not connected initially', () => {
  const client = new RabbitMQClient('amqp://localhost');
  assert.strictEqual(client.isConnected(), false);
});

// ==================== CONSUMERS ====================

test('should get all consumers (empty initially)', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const consumers = client.getAllConsumers();

  assert.ok(Array.isArray(consumers));
  assert.strictEqual(consumers.length, 0);
});

// ==================== METRICS ====================

test('should get initial metrics', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const metrics = client.getMetrics();

  assert.ok(typeof metrics === 'object');
  assert.ok(metrics.connection);
  assert.ok(metrics.publish);
  assert.ok(metrics.consume);
  assert.ok(metrics.queue);
  assert.ok(metrics.exchange);

  // Check structure
  assert.strictEqual(metrics.connection.totalConnections, 0);
  assert.strictEqual(metrics.publish.totalPublished, 0);
  assert.strictEqual(metrics.consume.totalConsumed, 0);
  assert.strictEqual(metrics.queue.totalAsserted, 0);
  assert.strictEqual(metrics.exchange.totalAsserted, 0);
});

test('should reset metrics', () => {
  const client = new RabbitMQClient('amqp://localhost');

  // Manually set some metrics
  client.metrics.connection.totalConnections = 10;
  client.metrics.publish.totalPublished = 50;

  // Reset
  client.resetMetrics();

  // Check they're reset
  const metrics = client.getMetrics();
  assert.strictEqual(metrics.connection.totalConnections, 0);
  assert.strictEqual(metrics.publish.totalPublished, 0);
});

// ==================== DLQ ====================

test('should get DLQ name', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    dlq: {
      enabled: true,
      queuePrefix: 'dlq',
    },
  });

  const dlqName = client.getDlqName('my_queue');
  assert.strictEqual(dlqName, 'dlq.my_queue');
});

test('should get DLQ name with custom prefix', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    dlq: {
      enabled: true,
      queuePrefix: 'dead-letters',
    },
  });

  const dlqName = client.getDlqName('orders');
  assert.strictEqual(dlqName, 'dead-letters.orders');
});

// ==================== HOOKS ====================

test('should support hooks configuration', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    hooks: {
      onPublish: () => {},
      onConsume: () => {},
      onError: () => {},
    },
  });

  assert.ok(client.options.hooks.onPublish);
  assert.ok(client.options.hooks.onConsume);
  assert.ok(client.options.hooks.onError);
  assert.strictEqual(typeof client.options.hooks.onPublish, 'function');
});

// ==================== TRACING ====================

test('should support tracing configuration', () => {
  const getTraceContext = () => 'trace-123';
  const setTraceContext = () => {};
  const generateTraceId = () => 'custom-trace-id';

  const client = new RabbitMQClient('amqp://localhost', {
    tracing: {
      enabled: true,
      headerName: 'x-custom-trace',
      correlationIdHeader: 'x-custom-correlation',
      getTraceContext,
      setTraceContext,
      generateTraceId,
    },
  });

  assert.strictEqual(client.options.tracing.enabled, true);
  assert.strictEqual(client.options.tracing.headerName, 'x-custom-trace');
  assert.strictEqual(client.options.tracing.correlationIdHeader, 'x-custom-correlation');
  assert.strictEqual(client.options.tracing.getTraceContext, getTraceContext);
  assert.strictEqual(client.options.tracing.setTraceContext, setTraceContext);
  assert.strictEqual(client.options.tracing.generateTraceId, generateTraceId);
});

// ==================== HEALTH CHECK ====================

test('should perform health check', async () => {
  const client = new RabbitMQClient('amqp://localhost');
  const health = await client.healthCheck();

  assert.ok(health);
  assert.ok(['healthy', 'unhealthy', 'degraded'].includes(health.status));
  assert.ok(health.timestamp);
  assert.ok(health.checks);
  assert.ok(health.checks.connection);
  assert.ok(health.checks.consumers);
});
