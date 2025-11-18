const { test } = require('node:test');
const assert = require('node:assert');
const RabbitMQClient = require('../lib/RabbitMQClient');

test('should create client instance', () => {
  const client = new RabbitMQClient('amqp://localhost');
  assert.ok(client instanceof RabbitMQClient);
});

test('should validate connection string', () => {
  assert.throws(() => {
    new RabbitMQClient('');
  }, /connectionString must be a non-empty string/);

  assert.throws(() => {
    new RabbitMQClient(null);
  }, /connectionString must be a non-empty string/);
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
      consumeRetry: {
        multiplier: 0,
      },
    });
  }, /consumeRetry\.multiplier must be a positive number/);
});

test('should validate DLQ config', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      dlq: {
        exchange: '',
      },
    });
  }, /dlq\.exchange must be a non-empty string/);
});

test('should have DLQ disabled by default', () => {
  const client = new RabbitMQClient('amqp://localhost');
  assert.strictEqual(client.dlq.enabled, false);
});

test('should enable DLQ when explicitly set', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    dlq: {
      enabled: true,
    },
  });
  assert.strictEqual(client.dlq.enabled, true);
});

test('should have default retry enabled', () => {
  const client = new RabbitMQClient('amqp://localhost');
  assert.strictEqual(client.publishRetry.enabled, true);
  assert.strictEqual(client.consumeRetry.enabled, true);
});

test('should generate correlation ID', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const id1 = client._generateCorrelationId();
  const id2 = client._generateCorrelationId();
  assert.ok(typeof id1 === 'string');
  assert.ok(id1.length > 0);
  assert.notStrictEqual(id1, id2);
});

test('should get correlation ID from options', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const customId = 'custom-correlation-id';
  const id = client._getCorrelationId(null, { correlationId: customId });
  assert.strictEqual(id, customId);
});

test('should calculate retry delay', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const delay1 = client._calculateRetryDelay(1, 1000, 10000, 2);
  const delay2 = client._calculateRetryDelay(2, 1000, 10000, 2);
  const delay3 = client._calculateRetryDelay(3, 1000, 10000, 2);

  assert.strictEqual(delay1, 1000);
  assert.strictEqual(delay2, 2000);
  assert.strictEqual(delay3, 4000);
});

test('should cap retry delay at max', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const delay = client._calculateRetryDelay(10, 1000, 5000, 2);
  assert.strictEqual(delay, 5000);
});

test('should get connection info', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const info = client.getConnectionInfo();

  assert.ok(typeof info === 'object');
  assert.strictEqual(info.connected, false);
  assert.strictEqual(info.connectionString, 'amqp://localhost');
  assert.strictEqual(info.autoReconnect, true);
});

test('should get all consumers', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const consumers = client.getAllConsumers();

  assert.ok(Array.isArray(consumers));
  assert.strictEqual(consumers.length, 0);
});

test('should get metrics', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const metrics = client.getMetrics();

  assert.ok(typeof metrics === 'object');
  assert.ok(metrics.connection);
  assert.ok(metrics.publish);
  assert.ok(metrics.consume);
  assert.ok(metrics.queue);
  assert.ok(metrics.exchange);
});

test('should reset metrics', () => {
  const client = new RabbitMQClient('amqp://localhost');
  client.metrics.connection.totalConnections = 10;
  client.resetMetrics();

  assert.strictEqual(client.metrics.connection.totalConnections, 0);
});

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

test('should have hooks support', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    hooks: {
      onPublish: () => {
        // Hook function
      },
    },
  });

  assert.ok(client.hooks.onPublish);
  assert.strictEqual(typeof client.hooks.onPublish, 'function');
});

test('should support custom serializer', () => {
  const customSerializer = (message) => {
    return Buffer.from(JSON.stringify({ custom: message }));
  };

  const client = new RabbitMQClient('amqp://localhost', {
    serializer: customSerializer,
  });

  assert.strictEqual(client.serializer, customSerializer);
});

test('should support custom deserializer', () => {
  const customDeserializer = (buffer) => {
    return JSON.parse(buffer.toString());
  };

  const client = new RabbitMQClient('amqp://localhost', {
    deserializer: customDeserializer,
  });

  assert.strictEqual(client.deserializer, customDeserializer);
});

test('should support tracing configuration', () => {
  const getTraceContext = () => 'trace-123';
  const setTraceContext = () => {};

  const client = new RabbitMQClient('amqp://localhost', {
    tracing: {
      enabled: true,
      headerName: 'x-trace-id',
      correlationIdHeader: 'x-correlation-id',
      getTraceContext,
      setTraceContext,
    },
  });

  assert.strictEqual(client.tracing.enabled, true);
  assert.strictEqual(client.tracing.headerName, 'x-trace-id');
  assert.strictEqual(client.tracing.correlationIdHeader, 'x-correlation-id');
  assert.strictEqual(client.tracing.getTraceContext, getTraceContext);
  assert.strictEqual(client.tracing.setTraceContext, setTraceContext);
});

test('should validate serializer', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      serializer: 'not-a-function',
    });
  }, /serializer must be a function/);
});

test('should validate deserializer', () => {
  assert.throws(() => {
    new RabbitMQClient('amqp://localhost', {
      deserializer: 'not-a-function',
    });
  }, /deserializer must be a function/);
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

test('should use default serializer', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const buffer = client.serializer({ test: 'data' });
  assert.ok(Buffer.isBuffer(buffer));
  assert.strictEqual(buffer.toString(), JSON.stringify({ test: 'data' }));
});

test('should use default deserializer', () => {
  const client = new RabbitMQClient('amqp://localhost');
  const buffer = Buffer.from(JSON.stringify({ test: 'data' }));
  const result = client.deserializer(buffer);
  assert.deepStrictEqual(result, { test: 'data' });
});

test('should auto-generate trace ID when tracing enabled', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    tracing: {
      enabled: true,
      getTraceContext: () => null, // Нет trace context
    },
  });

  const traceId = client._getTraceId({});
  assert.ok(traceId);
  assert.ok(typeof traceId === 'string');
  assert.ok(traceId.length > 0);
});

test('should use trace ID from context when available', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    tracing: {
      enabled: true,
      getTraceContext: () => 'trace-from-context',
    },
  });

  const traceId = client._getTraceId({});
  assert.strictEqual(traceId, 'trace-from-context');
});

test('should use trace ID from options when provided', () => {
  const client = new RabbitMQClient('amqp://localhost', {
    tracing: {
      enabled: true,
      getTraceContext: () => 'trace-from-context',
    },
  });

  const traceId = client._getTraceId({ traceId: 'trace-from-options' });
  assert.strictEqual(traceId, 'trace-from-options');
});

test('should support custom trace ID generator', () => {
  const customGenerator = () => 'custom-trace-id';
  const client = new RabbitMQClient('amqp://localhost', {
    tracing: {
      enabled: true,
      generateTraceId: customGenerator,
      getTraceContext: () => null,
    },
  });

  const traceId = client._getTraceId({});
  assert.strictEqual(traceId, 'custom-trace-id');
});
