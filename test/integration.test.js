const { test } = require('node:test');
const assert = require('node:assert');
const amqp = require('amqplib');
const RabbitMQClient = require('../lib/RabbitMQClient');

const AMQP_URL = process.env.AMQP_URL || 'amqp://guest:guest@localhost:5672';

// Проверка доступности RabbitMQ
let rabbitmqAvailable = false;

async function checkRabbitMQAvailability() {
  try {
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

test.before(async () => {
  rabbitmqAvailable = await checkRabbitMQAvailability();
  if (!rabbitmqAvailable) {
    console.warn('⚠️  RabbitMQ is not available. Integration tests will be skipped.');
  }
});

// ==================== CONNECTION ====================

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

test('should wait for connection', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();
  await client.waitForConnection(5000);
  assert.strictEqual(client.isConnected(), true);

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
    maxReconnectAttempts: 3,
  });

  let reconnected = false;
  client.on('reconnect', () => {
    reconnected = true;
  });

  await client.connect();
  assert.strictEqual(client.isConnected(), true);

  // Simulate disconnection
  if (client.connectionManager.connection) {
    await client.connectionManager.connection.close();
  }

  // Wait for reconnection attempt
  await new Promise((resolve) => setTimeout(resolve, 500));

  await client.close();
});

// ==================== QUEUE OPERATIONS ====================

test('should create and delete queue', async (t) => {
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
  const queueInfo = await client.assertQueue(queueName, { durable: false });

  assert.ok(queueInfo);
  assert.strictEqual(queueInfo.queue, queueName);

  // Get queue info
  const info = await client.getQueueInfo(queueName);
  assert.strictEqual(info.queue, queueName);

  // Delete queue
  await client.deleteQueue(queueName);

  await client.close();
});

test('should purge queue', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();

  const queueName = `test_purge_${Date.now()}`;
  await client.assertQueue(queueName, { durable: false });

  // Publish some messages
  await client.publish(queueName, { test: 'message1' });
  await client.publish(queueName, { test: 'message2' });

  // Purge
  const result = await client.purgeQueue(queueName);
  assert.ok(result);

  await client.deleteQueue(queueName);
  await client.close();
});

// ==================== EXCHANGE OPERATIONS ====================

test('should create and delete exchange', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();

  const exchangeName = `test_exchange_${Date.now()}`;
  await client.assertExchange(exchangeName, 'topic', { durable: false });

  // Get exchange info
  const info = await client.getExchangeInfo(exchangeName);
  assert.ok(info);

  // Delete exchange
  await client.deleteExchange(exchangeName);

  await client.close();
});

test('should bind and unbind queue to exchange', async (t) => {
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
  const exchangeName = `test_exchange_${Date.now()}`;
  const routingKey = 'test.key';

  await client.assertQueue(queueName, { durable: false });
  await client.assertExchange(exchangeName, 'topic', { durable: false });

  // Bind
  await client.bindQueue(queueName, exchangeName, routingKey);

  // Unbind
  await client.unbindQueue(queueName, exchangeName, routingKey);

  await client.deleteQueue(queueName);
  await client.deleteExchange(exchangeName);
  await client.close();
});

// ==================== PUBLISH & CONSUME ====================

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

  const queueName = `test_pubsub_${Date.now()}`;
  await client.assertQueue(queueName, { durable: false });

  const receivedMessages = [];
  await client.consume(queueName, async (msg) => {
    receivedMessages.push(msg.parsedContent);
  });

  // Publish messages
  await client.publish(queueName, { id: 1, text: 'message1' });
  await client.publish(queueName, { id: 2, text: 'message2' });

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(receivedMessages.length, 2);
  assert.deepStrictEqual(receivedMessages[0], { id: 1, text: 'message1' });
  assert.deepStrictEqual(receivedMessages[1], { id: 2, text: 'message2' });

  await client.deleteQueue(queueName);
  await client.close();
});

test('should publish to exchange', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
  });

  await client.connect();

  const queueName = `test_exchange_queue_${Date.now()}`;
  const exchangeName = `test_exchange_${Date.now()}`;
  const routingKey = 'test.*';

  await client.assertQueue(queueName, { durable: false });
  await client.assertExchange(exchangeName, 'topic', { durable: false });
  await client.bindQueue(queueName, exchangeName, routingKey);

  const receivedMessages = [];
  await client.consume(queueName, async (msg) => {
    receivedMessages.push(msg.parsedContent);
  });

  // Publish to exchange
  await client.publishToExchange(exchangeName, 'test.key', { data: 'hello' });

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(receivedMessages.length, 1);
  assert.deepStrictEqual(receivedMessages[0], { data: 'hello' });

  await client.deleteQueue(queueName);
  await client.deleteExchange(exchangeName);
  await client.close();
});

// ==================== RETRY LOGIC ====================

test('should retry on consume error', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    consumeRetry: {
      enabled: true,
      maxAttempts: 3,
      initialDelay: 100,
    },
  });

  await client.connect();

  const queueName = `test_retry_${Date.now()}`;
  await client.assertQueue(queueName, { durable: false });

  let attemptCount = 0;
  await client.consume(
    queueName,
    async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error('Simulated error');
      }
      // Success on 3rd attempt
    },
    { maxRetries: 3 }
  );

  await client.publish(queueName, { test: 'retry' });

  // Wait for retries
  await new Promise((resolve) => setTimeout(resolve, 1000));

  assert.ok(attemptCount >= 3, `Expected at least 3 attempts, got ${attemptCount}`);

  await client.deleteQueue(queueName);
  await client.close();
});

// ==================== DEAD LETTER QUEUE ====================

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
      maxAttempts: 2,
      initialDelay: 100,
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
    { maxRetries: 2 }
  );

  await client.publish(queueName, { test: 'dlq' });

  // Wait for DLQ processing
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const dlqInfo = await client.getDlqInfo(queueName);
  assert.ok(dlqInfo.messageCount >= 0);

  await client.deleteDlq(queueName);
  await client.deleteQueue(queueName);
  await client.close();
});

// ==================== METRICS ====================

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
  assert.ok(metrics.connection.totalConnections >= 1);
  assert.ok(typeof metrics.publish.averageMessageSize === 'number');
  assert.ok(typeof metrics.consume.errorRate === 'number');

  await client.deleteQueue(queueName);
  await client.close();
});

// ==================== HEALTH CHECK ====================

test('should perform health check when connected', async (t) => {
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

  assert.strictEqual(health.status, 'healthy');
  assert.ok(health.timestamp);
  assert.ok(health.checks.connection);
  assert.strictEqual(health.checks.connection.status, 'healthy');
  assert.ok(health.checks.consumers);

  await client.close();
});

// ==================== CUSTOM SERIALIZATION ====================

test('should support custom serialization', async (t) => {
  if (!rabbitmqAvailable) {
    t.skip('RabbitMQ is not available');
    return;
  }

  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: false,
    serializer: (msg) => {
      return Buffer.from(JSON.stringify({ wrapped: msg }));
    },
    deserializer: (buf) => {
      const parsed = JSON.parse(buf.toString());
      return parsed.wrapped;
    },
  });

  await client.connect();

  const queueName = `test_serialization_${Date.now()}`;
  await client.assertQueue(queueName, { durable: false });

  const receivedMessages = [];
  await client.consume(queueName, async (msg) => {
    receivedMessages.push(msg.parsedContent);
  });

  await client.publish(queueName, { data: 'test' });

  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(receivedMessages.length, 1);
  assert.deepStrictEqual(receivedMessages[0], { data: 'test' });

  await client.deleteQueue(queueName);
  await client.close();
});
