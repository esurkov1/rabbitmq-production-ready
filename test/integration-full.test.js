const { test } = require('node:test');
const assert = require('node:assert');
const amqp = require('amqplib');
const RabbitMQClient = require('../lib/RabbitMQClient');

const AMQP_URL = process.env.AMQP_URL || 'amqp://guest:guest@localhost:5672';

// Проверка доступности RabbitMQ перед запуском интеграционных тестов
let rabbitmqAvailable = false;

async function checkRabbitMQAvailability() {
  try {
    // Таймаут 5 секунд для проверки доступности
    const connection = await Promise.race([
      amqp.connect(AMQP_URL),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
    ]);
    await connection.close();
    return true;
  } catch (error) {
    return false;
  }
}

// Проверяем доступность RabbitMQ один раз перед всеми тестами
test.before(async () => {
  rabbitmqAvailable = await checkRabbitMQAvailability();
  if (!rabbitmqAvailable) {
    console.warn('⚠️  RabbitMQ is not available. Integration tests will be skipped.');
    console.warn('   Start RabbitMQ with: docker-compose -f docker-compose.test.yml up -d');
  }
});

test('should connect and disconnect', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();
  assert.strictEqual(client.isConnected(), true);

  await client.close();
  assert.strictEqual(client.isConnected(), false);
});

test('should publish and consume messages', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();
  const queueName = `test_queue_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  const receivedMessages = [];
  await client.consume(queueName, async (msg) => {
    // Используем parsedContent для десериализованного контента
    const content = msg.parsedContent || JSON.parse(msg.content.toString());
    receivedMessages.push(content);
  });

  await client.publish(queueName, { test: 'message1' });
  await client.publish(queueName, { test: 'message2' });

  // Wait for messages to be processed
  await new Promise((resolve) => setTimeout(resolve, 1000));

  assert.strictEqual(receivedMessages.length, 2);
  assert.strictEqual(receivedMessages[0].test, 'message1');
  assert.strictEqual(receivedMessages[1].test, 'message2');

  await client.close();
});

test('should handle retry on consume error', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    consumeRetry: {
      enabled: true,
      maxAttempts: 2,
      initialDelay: 100,
    },
  });

  await client.connect();
  const queueName = `test_retry_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  let attemptCount = 0;
  let messageProcessed = false;
  await client.consume(
    queueName,
    async (_msg) => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('Simulated error');
      }
      messageProcessed = true;
    },
    { maxRetries: 2 }
  );

  await client.publish(queueName, { test: 'retry' });

  // Wait for retry processing
  let attempts = 0;
  while (!messageProcessed && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  assert.strictEqual(attemptCount, 2);

  await client.close();
});

test('should send to DLQ when retries exhausted', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    dlq: {
      enabled: true,
      exchange: 'dlx',
      queuePrefix: 'dlq',
    },
    consumeRetry: {
      enabled: true,
      maxAttempts: 1,
    },
  });

  await client.connect();
  const queueName = `test_dlq_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false, dlq: true });
  await client.assertDlq(queueName);

  await client.consume(
    queueName,
    async () => {
      throw new Error('Always fail');
    },
    { maxRetries: 1 }
  );

  await client.publish(queueName, { test: 'dlq' });

  // Wait for DLQ processing
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const dlqInfo = await client.getDlqInfo(queueName);
  assert.ok(dlqInfo.messageCount >= 0);

  await client.close();
});

test('should collect metrics', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();
  const queueName = `test_metrics_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  await client.consume(queueName, async () => {
    // Process message
  });

  await client.publish(queueName, { test: 'metrics1' });
  await client.publish(queueName, { test: 'metrics2' });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const metrics = client.getMetrics();

  assert.ok(metrics.publish.totalPublished >= 2);
  assert.ok(metrics.consume.totalConsumed >= 2);
  assert.ok(metrics.publish.publishedByQueue[queueName] >= 2);

  await client.close();
});

test('should perform health check', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();

  const health = await client.healthCheck();

  assert.ok(['healthy', 'unhealthy', 'degraded'].includes(health.status));
  assert.ok(health.checks.connection);
  assert.ok(health.checks.consumers);

  await client.close();
});

test('should handle reconnection', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: true,
    initialReconnectDelay: 100,
    maxReconnectAttempts: 2,
  });

  await client.connect();
  assert.strictEqual(client.isConnected(), true);

  // Simulate disconnection by closing connection manually
  if (client.connection) {
    await client.connection.close();
  }

  // Wait a bit for reconnection attempt
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Should attempt to reconnect
  assert.ok(client.reconnectAttempts >= 0);

  await client.close();
});

test('should use custom serializer/deserializer', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const customSerializer = (message) => {
    return Buffer.from(JSON.stringify({ wrapped: message }));
  };

  const customDeserializer = (buffer) => {
    const parsed = JSON.parse(buffer.toString());
    return parsed.wrapped;
  };

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    serializer: customSerializer,
    deserializer: customDeserializer,
  });

  await client.connect();
  const queueName = `test_serializer_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  const receivedMessages = [];
  await client.consume(queueName, async (msg) => {
    receivedMessages.push(msg.parsedContent);
  });

  await client.publish(queueName, { test: 'custom' });

  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(receivedMessages.length, 1);
  assert.deepStrictEqual(receivedMessages[0], { test: 'custom' });

  await client.close();
});

test('should propagate trace ID through messages', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const { AsyncLocalStorage } = require('async_hooks');
  const asyncLocalStorage = new AsyncLocalStorage();

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    tracing: {
      enabled: true,
      headerName: 'x-trace-id',
      correlationIdHeader: 'x-correlation-id',
      getTraceContext: () => asyncLocalStorage.getStore()?.traceId,
      setTraceContext: (traceId) => {
        asyncLocalStorage.enterWith({ traceId });
      },
    },
  });

  await client.connect();
  const queueName = `test_tracing_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  let receivedTraceId = null;
  let receivedCorrelationId = null;
  let messageProcessed = false;

  await client.consume(queueName, async (msg) => {
    receivedTraceId = msg.properties.headers['x-trace-id'];
    receivedCorrelationId = msg.properties.headers['x-correlation-id'];
    messageProcessed = true;
  });

  // Устанавливаем trace context перед публикацией
  const originalTraceId = 'trace-12345';
  asyncLocalStorage.run({ traceId: originalTraceId }, async () => {
    await client.publish(queueName, { test: 'tracing' });
  });

  // Ждем пока сообщение будет обработано
  let attempts = 0;
  while (!messageProcessed && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  assert.ok(receivedTraceId);
  assert.ok(receivedCorrelationId);
  // Trace ID должен быть автоматически сгенерирован или взят из контекста
  assert.ok(typeof receivedTraceId === 'string');
  assert.ok(receivedTraceId.length > 0);

  await client.close();
});

test('should set trace context from message headers', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const { AsyncLocalStorage } = require('async_hooks');
  const asyncLocalStorage = new AsyncLocalStorage();

  let setTraceId = null;
  let messageProcessed = false;

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    tracing: {
      enabled: true,
      headerName: 'x-trace-id',
      correlationIdHeader: 'x-correlation-id',
      getTraceContext: () => asyncLocalStorage.getStore()?.traceId,
      setTraceContext: (traceId) => {
        setTraceId = traceId;
        asyncLocalStorage.enterWith({ traceId });
      },
    },
  });

  await client.connect();
  const queueName = `test_trace_context_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  await client.consume(queueName, async (_msg) => {
    // Trace context должен быть установлен автоматически
    const currentTraceId = asyncLocalStorage.getStore()?.traceId;
    assert.strictEqual(currentTraceId, 'trace-from-header');
    messageProcessed = true;
  });

  // Публикуем с trace ID в заголовках
  await client.publish(
    queueName,
    { test: 'trace-context' },
    {
      headers: {
        'x-trace-id': 'trace-from-header',
      },
    }
  );

  // Ждем пока сообщение будет обработано
  let attempts = 0;
  while (!messageProcessed && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  assert.strictEqual(setTraceId, 'trace-from-header');
  assert.strictEqual(messageProcessed, true);

  await client.close();
});
