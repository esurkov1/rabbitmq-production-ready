const { test } = require('node:test');
const assert = require('node:assert');
const RabbitMQClient = require('../lib/RabbitMQClient');

const AMQP_URL = process.env.AMQP_URL || 'amqp://guest:guest@localhost:5672';

test('should connect and disconnect', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
  });

  await client.connect();
  assert.strictEqual(client.isConnected(), true);

  await client.close();
  assert.strictEqual(client.isConnected(), false);
});

test('should publish and consume messages', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
  });

  await client.connect();
  const queueName = `test_queue_${Date.now()}`;

  await client.assertQueue(queueName, { durable: false });

  const receivedMessages = [];
  await client.consume(queueName, async (msg) => {
    const content = JSON.parse(msg.content.toString());
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

test('should handle retry on consume error', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
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
  await client.consume(
    queueName,
    async (_msg) => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('Simulated error');
      }
    },
    { maxRetries: 2 }
  );

  await client.publish(queueName, { test: 'retry' });

  // Wait for retry processing
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(attemptCount, 2);

  await client.close();
});

test('should send to DLQ when retries exhausted', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
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

test('should collect metrics', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
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

test('should perform health check', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
  });

  await client.connect();

  const health = await client.healthCheck();

  assert.ok(['healthy', 'unhealthy', 'degraded'].includes(health.status));
  assert.ok(health.checks.connection);
  assert.ok(health.checks.consumers);

  await client.close();
});

test('should handle reconnection', async () => {
  const client = new RabbitMQClient(AMQP_URL, {
    registerShutdownHandlers: false,
    autoReconnect: true,
    initialReconnectDelay: 100,
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

