# RabbitMQ Production-Ready Client

[![npm version](https://img.shields.io/npm/v/rabbitmq-production-ready.svg)](https://www.npmjs.com/package/rabbitmq-production-ready)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/rabbitmq-production-ready.svg)](https://nodejs.org/)
[![GitHub](https://img.shields.io/github/stars/esurkov1/rabbitmq-production-ready.svg)](https://github.com/esurkov1/rabbitmq-production-ready)

**🇷🇺 [Русская версия документации](README.ru.md)**

Production-ready RabbitMQ client for Node.js with auto-reconnect, retry logic, DLQ support, metrics, health checks, and comprehensive error handling.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Why This Library?](#why-this-library)
- [Core Concepts](#core-concepts)
- [Configuration Guide](#configuration-guide)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [TypeScript Support](#typescript-support)
- [Events](#events)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Features

- ✅ **Auto-reconnect** with exponential backoff - Never lose connection
- ✅ **Retry logic** for publish and consume operations - Handle transient failures
- ✅ **Dead Letter Queue (DLQ)** support - Capture failed messages
- ✅ **Structured logging** with Pino - Production-ready logging
- ✅ **Metrics** collection - Monitor your messaging patterns
- ✅ **Health checks** - Integration-ready health endpoints
- ✅ **Graceful shutdown** - Clean application termination
- ✅ **Correlation IDs** - Track messages across services
- ✅ **TypeScript** support - Full type definitions included
- ✅ **Hooks** for Prometheus integration - Export metrics easily
- ✅ **Event-driven** - React to connection changes
- ✅ **Queue & Exchange management** - Complete RabbitMQ control

## Installation

```bash
npm install rabbitmq-production-ready
```

**Requirements:**

- Node.js >= 18.0.0
- RabbitMQ server (3.x or later)

## Quick Start

### For Beginners

Get up and running in under 2 minutes:

```javascript
const RabbitMQClient = require('rabbitmq-production-ready');

async function main() {
  // 1. Create client instance
  const client = new RabbitMQClient('amqp://localhost');

  try {
    // 2. Connect to RabbitMQ
    await client.connect();
    console.log('✅ Connected to RabbitMQ');

    // 3. Create a queue (if it doesn't exist)
    await client.assertQueue('my_queue', { durable: true });
    console.log('✅ Queue ready');

    // 4. Publish a message
    await client.publish('my_queue', {
      userId: 123,
      action: 'user.created',
      timestamp: Date.now(),
    });
    console.log('✅ Message published');

    // 5. Consume messages
    await client.consume('my_queue', async (msg) => {
      const content = JSON.parse(msg.content.toString());
      console.log('📨 Received:', content);

      // Your business logic here
      // Process the message...

      // Message is automatically acknowledged if handler succeeds
    });
    console.log('✅ Consumer started');

    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      await client.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
```

**Run it:**

```bash
node your-script.js
```

### For Professionals

Production-ready setup with error handling, DLQ, and metrics:

```javascript
const RabbitMQClient = require('rabbitmq-production-ready');
const pino = require('pino');

const client = new RabbitMQClient(process.env.AMQP_URL, {
  // Logging
  logger: pino({ level: process.env.LOG_LEVEL || 'info' }),

  // Auto-reconnect with exponential backoff
  autoReconnect: true,
  maxReconnectAttempts: Infinity,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,

  // Retry configuration
  publishRetry: {
    enabled: true,
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
  },
  consumeRetry: {
    enabled: true,
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
  },

  // Dead Letter Queue for failed messages
  dlq: {
    enabled: true,
    exchange: 'dlx',
    queuePrefix: 'dlq',
  },

  // Graceful shutdown timeout
  shutdownTimeout: 10000,

  // Prometheus metrics hooks
  hooks: {
    onPublish: (data) => {
      // Export to Prometheus
      prometheusCounter.inc({ queue: data.queue });
    },
    onConsume: (data) => {
      prometheusHistogram.observe(data.processingTime);
    },
    onError: (data) => {
      prometheusErrorCounter.inc({ type: data.type });
    },
  },
});

// Connection event handlers
client.on('connected', () => {
  console.log('Connected to RabbitMQ');
});

client.on('reconnect', () => {
  console.log('Reconnected after disconnection');
});

client.on('error', (error) => {
  console.error('RabbitMQ error:', error);
});

// Initialize
async function init() {
  await client.connect();
  await client.assertQueue('orders', { durable: true, dlq: true });
  await client.assertDlq('orders');

  // Start consuming
  await client.consume(
    'orders',
    async (msg) => {
      const order = JSON.parse(msg.content.toString());
      // Process order...
      await processOrder(order);
    },
    {
      prefetch: 10, // Process up to 10 messages concurrently
      maxRetries: 3,
    }
  );
}

init().catch(console.error);
```

## Why This Library?

### Problems It Solves

1. **Connection Management**
   - ❌ Standard clients drop connections and don't reconnect
   - ✅ Auto-reconnect with exponential backoff keeps you connected

2. **Error Handling**
   - ❌ Failed messages are lost or cause infinite loops
   - ✅ Retry logic + DLQ ensures message delivery

3. **Observability**
   - ❌ No visibility into message flow
   - ✅ Built-in metrics and health checks

4. **Production Readiness**
   - ❌ Missing graceful shutdown, correlation IDs, structured logging
   - ✅ All production features included

### Comparison

| Feature           | Standard Client | This Library |
| ----------------- | --------------- | ------------ |
| Auto-reconnect    | ❌              | ✅           |
| Retry logic       | ❌              | ✅           |
| DLQ support       | Manual          | ✅ Built-in  |
| Metrics           | ❌              | ✅           |
| Health checks     | ❌              | ✅           |
| Graceful shutdown | Manual          | ✅ Automatic |
| Correlation IDs   | Manual          | ✅ Automatic |
| TypeScript        | ❌              | ✅           |

## Core Concepts

### 1. Connection Management

The client manages connections automatically:

```javascript
// Connect once
await client.connect();

// Client handles reconnections automatically
// You can listen to events:
client.on('connected', () => console.log('Connected'));
client.on('reconnect', () => console.log('Reconnected'));
client.on('disconnected', () => console.log('Disconnected'));
```

### 2. Message Publishing

Publish messages to queues or exchanges:

```javascript
// Direct to queue
await client.publish('my_queue', { data: 'Hello' });

// Through exchange
await client.publishToExchange('events', 'user.created', {
  userId: 123,
  action: 'created',
});
```

### 3. Message Consumption

Consume messages with automatic acknowledgment:

```javascript
await client.consume('my_queue', async (msg) => {
  // Process message
  const data = JSON.parse(msg.content.toString());

  // If handler succeeds, message is acknowledged
  // If handler throws, message is retried or sent to DLQ
});
```

### 4. Retry Logic

Automatic retries for failed operations:

```javascript
// Publish retry - retries if publish fails
await client.publish('queue', data, { retry: true });

// Consume retry - retries if handler throws error
await client.consume('queue', handler, {
  maxRetries: 3, // Retry up to 3 times
  retry: true,
});
```

### 5. Dead Letter Queue

Failed messages go to DLQ:

```javascript
// Enable DLQ
const client = new RabbitMQClient('amqp://localhost', {
  dlq: { enabled: true },
});

// Create queue with DLQ
await client.assertQueue('orders', { dlq: true });

// Failed messages automatically go to 'dlq.orders'
```

## Configuration Guide

### Basic Configuration

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  // Minimal config - uses sensible defaults
});
```

### Advanced Configuration

```javascript
const client = new RabbitMQClient('amqp://user:pass@host:5672/vhost', {
  // Logging
  logger: pino({ level: 'info' }),
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'

  // Auto-reconnect
  autoReconnect: true, // Default: true
  maxReconnectAttempts: Infinity, // Default: Infinity
  initialReconnectDelay: 1000, // Default: 1000ms
  maxReconnectDelay: 30000, // Default: 30000ms
  reconnectMultiplier: 2, // Default: 2 (exponential backoff)

  // Publish retry
  publishRetry: {
    enabled: true, // Default: true
    maxAttempts: 3, // Default: 3
    initialDelay: 1000, // Default: 1000ms
    maxDelay: 10000, // Default: 10000ms
    multiplier: 2, // Default: 2
  },

  // Consume retry
  consumeRetry: {
    enabled: true, // Default: true
    maxAttempts: 3, // Default: 3
    initialDelay: 1000, // Default: 1000ms
    maxDelay: 10000, // Default: 10000ms
    multiplier: 2, // Default: 2
  },

  // Dead Letter Queue
  dlq: {
    enabled: false, // Default: false
    exchange: 'dlx', // Default: 'dlx'
    queuePrefix: 'dlq', // Default: 'dlq'
    ttl: null, // Default: null (no TTL)
  },

  // Graceful shutdown
  shutdownTimeout: 10000, // Default: 10000ms

  // Shutdown handlers
  registerShutdownHandlers: true, // Default: true

  // Custom correlation ID generator
  correlationIdGenerator: () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  },

  // Hooks for external integrations
  hooks: {
    onPublish: (data) => {
      // Called after successful publish
      // data: { queue, exchange, routingKey?, messageSize, duration, correlationId }
    },
    onConsume: (data) => {
      // Called after successful consume
      // data: { queue, processingTime, correlationId, retryCount }
    },
    onError: (data) => {
      // Called on errors
      // data: { type: 'publish' | 'consume', error, queue?, exchange?, correlationId?, retryCount? }
    },
    onConnectionChange: (data) => {
      // Called on connection changes
      // data: { connected: boolean, wasReconnect?: boolean }
    },
  },
});
```

### Connection String Format

```
amqp://[username]:[password]@[host]:[port]/[vhost]
```

Examples:

- `amqp://localhost` - Local, default credentials
- `amqp://guest:guest@localhost:5672` - Explicit credentials
- `amqp://user:pass@rabbitmq.example.com:5672/production` - Full URL
- `amqps://user:pass@rabbitmq.example.com:5671` - TLS connection

## API Reference

### Connection Management

#### `connect(): Promise<void>`

Connect to RabbitMQ. Idempotent - safe to call multiple times.

```javascript
await client.connect();
```

**Throws:** `Error` if connection fails and auto-reconnect is disabled

#### `close(): Promise<void>`

Gracefully close connection and stop all consumers. Waits for pending operations to complete.

```javascript
await client.close();
```

**Behavior:**

- Stops all active consumers
- Waits for pending operations (up to `shutdownTimeout`)
- Closes connection and channel
- Emits `close` event

#### `isConnected(): boolean`

Check if client is currently connected.

```javascript
if (client.isConnected()) {
  await client.publish('queue', data);
}
```

#### `waitForConnection(timeout?: number, interval?: number): Promise<void>`

Wait for connection to be established with timeout.

```javascript
try {
  await client.waitForConnection(30000, 100); // 30s timeout, check every 100ms
  console.log('Connected!');
} catch (error) {
  console.error('Connection timeout');
}
```

**Parameters:**

- `timeout` (default: 30000) - Maximum wait time in milliseconds
- `interval` (default: 100) - Check interval in milliseconds

#### `getConnectionInfo(): object`

Get detailed connection information.

```javascript
const info = client.getConnectionInfo();
// {
//   connected: true,
//   connectionString: 'amqp://localhost',
//   reconnectAttempts: 0,
//   autoReconnect: true,
//   maxReconnectAttempts: Infinity,
//   lastConnectionTime: 1234567890,
//   lastDisconnectionTime: null,
//   totalConnections: 1,
//   totalReconnects: 0,
//   connectionErrors: 0
// }
```

### Publishing

#### `publish(queue: string, message: any, options?: PublishOptions): Promise<boolean>`

Publish message directly to queue.

```javascript
// Simple publish
await client.publish('my_queue', { data: 'Hello' });

// With options
await client.publish(
  'my_queue',
  { data: 'Hello' },
  {
    persistent: true, // Message survives broker restart
    correlationId: 'custom-id', // Custom correlation ID
    retry: true, // Enable retry on failure
    expiration: '60000', // Message TTL in milliseconds
    priority: 5, // Message priority (0-255)
    headers: {
      'x-custom-header': 'value',
    },
  }
);
```

**Parameters:**

- `queue` - Queue name
- `message` - Message payload (object, string, or Buffer)
- `options` - Publishing options (see amqplib Options.Publish)

**Returns:** `Promise<boolean>` - `true` if message was sent, `false` if channel is full

**Message Format:**

- Objects are automatically JSON stringified
- Strings are sent as-is
- Buffers are sent as binary

#### `publishToExchange(exchange: string, routingKey: string, message: any, options?: PublishOptions): Promise<boolean>`

Publish message through exchange.

```javascript
// Topic exchange
await client.publishToExchange('events', 'user.created', {
  userId: 123,
  action: 'created',
});

// Direct exchange
await client.publishToExchange('orders', 'order.processed', orderData);

// Fanout exchange (routingKey ignored)
await client.publishToExchange('notifications', '', notificationData);
```

### Consuming

#### `consume(queue: string, handler: Function, options?: ConsumeOptions): Promise<string>`

Start consuming messages from queue.

```javascript
const consumerTag = await client.consume(
  'my_queue',
  async (msg) => {
    const content = JSON.parse(msg.content.toString());

    // Process message
    await processMessage(content);

    // Message is automatically acknowledged if handler succeeds
    // If handler throws, message is retried or sent to DLQ
  },
  {
    prefetch: 10, // Process up to 10 messages concurrently
    maxRetries: 3, // Retry up to 3 times on error
    retry: true, // Enable retry logic
    requeue: true, // Requeue on error (if retry disabled)
    noAck: false, // Manual acknowledgment (default: false)
  }
);
```

**Handler Function:**

- Receives `msg` object from amqplib
- If handler succeeds, message is automatically acknowledged
- If handler throws, message is retried or sent to DLQ based on configuration

**Options:**

- `prefetch` - Number of unacknowledged messages to prefetch
- `maxRetries` - Maximum retry attempts (default: from `consumeRetry.maxAttempts`)
- `retry` - Enable retry logic (default: true)
- `requeue` - Requeue message on error (default: true)
- `noAck` - Disable automatic acknowledgment (default: false)

**Returns:** `Promise<string>` - Consumer tag

#### `stopConsuming(queue: string): Promise<void>`

Stop consuming messages from queue.

```javascript
await client.stopConsuming('my_queue');
```

#### `getAllConsumers(): Array<{queue: string, consumerTag: string}>`

Get list of all active consumers.

```javascript
const consumers = client.getAllConsumers();
// [{ queue: 'my_queue', consumerTag: 'amq.ctag-...' }]
```

### Queue Management

#### `assertQueue(queue: string, options?: AssertQueueOptions): Promise<QueueInfo>`

Create or verify queue exists.

```javascript
const queueInfo = await client.assertQueue('my_queue', {
  durable: true, // Survive broker restart
  exclusive: false, // Not exclusive to connection
  autoDelete: false, // Don't delete when unused
  dlq: true, // Enable DLQ (if dlq.enabled in config)
  arguments: {
    'x-message-ttl': 60000, // Message TTL
    'x-max-length': 1000, // Max queue length
  },
});
```

**Returns:** Queue information object

#### `deleteQueue(queue: string, options?: DeleteQueueOptions): Promise<DeleteQueueResult>`

Delete queue.

```javascript
await client.deleteQueue('my_queue', {
  ifUnused: true, // Only delete if no consumers
  ifEmpty: true, // Only delete if empty
});
```

#### `purgeQueue(queue: string): Promise<PurgeQueueResult>`

Remove all messages from queue without deleting it.

```javascript
await client.purgeQueue('my_queue');
```

#### `getQueueInfo(queue: string): Promise<QueueInfo>`

Get queue information (message count, consumer count, etc.).

```javascript
const info = await client.getQueueInfo('my_queue');
// {
//   queue: 'my_queue',
//   messageCount: 10,
//   consumerCount: 1
// }
```

### Exchange Management

#### `assertExchange(exchange: string, type: string, options?: AssertExchangeOptions): Promise<ExchangeInfo>`

Create or verify exchange exists.

```javascript
// Topic exchange
await client.assertExchange('events', 'topic', { durable: true });

// Direct exchange
await client.assertExchange('orders', 'direct', { durable: true });

// Fanout exchange
await client.assertExchange('notifications', 'fanout', { durable: true });

// Headers exchange
await client.assertExchange('routing', 'headers', { durable: true });
```

**Exchange Types:**

- `direct` - Routing based on exact routing key match
- `topic` - Routing based on pattern matching
- `fanout` - Broadcast to all bound queues
- `headers` - Routing based on message headers

#### `deleteExchange(exchange: string, options?: DeleteExchangeOptions): Promise<void>`

Delete exchange.

```javascript
await client.deleteExchange('my_exchange', {
  ifUnused: true, // Only delete if no queues bound
});
```

#### `bindQueue(queue: string, exchange: string, routingKey: string, args?: object): Promise<void>`

Bind queue to exchange.

```javascript
// Topic binding
await client.bindQueue('user_events', 'events', 'user.*');

// Direct binding
await client.bindQueue('orders', 'orders', 'order.created');
```

#### `unbindQueue(queue: string, exchange: string, routingKey: string, args?: object): Promise<void>`

Unbind queue from exchange.

```javascript
await client.unbindQueue('user_events', 'events', 'user.*');
```

#### `getExchangeInfo(exchange: string): Promise<ExchangeInfo>`

Get exchange information.

```javascript
const info = await client.getExchangeInfo('my_exchange');
```

### Dead Letter Queue

#### `getDlqName(queue: string): string`

Get DLQ name for queue.

```javascript
const dlqName = client.getDlqName('orders'); // 'dlq.orders'
```

#### `assertDlq(queue: string): Promise<QueueInfo>`

Create or verify DLQ exists for queue.

```javascript
await client.assertDlq('orders');
```

#### `getDlqInfo(queue: string): Promise<QueueInfo>`

Get DLQ information.

```javascript
const dlqInfo = await client.getDlqInfo('orders');
console.log(`DLQ has ${dlqInfo.messageCount} messages`);
```

#### `purgeDlq(queue: string): Promise<PurgeQueueResult>`

Remove all messages from DLQ.

```javascript
await client.purgeDlq('orders');
```

#### `deleteDlq(queue: string, options?: DeleteQueueOptions): Promise<DeleteQueueResult>`

Delete DLQ.

```javascript
await client.deleteDlq('orders');
```

### Health & Metrics

#### `healthCheck(): Promise<HealthCheckResult>`

Perform health check. Useful for health endpoints.

```javascript
const health = await client.healthCheck();
// {
//   status: 'healthy' | 'unhealthy' | 'degraded',
//   timestamp: '2024-01-01T00:00:00.000Z',
//   checks: {
//     connection: {
//       status: 'healthy',
//       message: 'Connected'
//     },
//     consumers: {
//       status: 'healthy',
//       count: 2,
//       queues: ['queue1', 'queue2']
//     }
//   }
// }

// Use in Express health endpoint
app.get('/health', async (req, res) => {
  const health = await client.healthCheck();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

#### `getMetrics(): Metrics`

Get collected metrics.

```javascript
const metrics = client.getMetrics();
// {
//   connection: {
//     totalConnections: 1,
//     totalReconnects: 0,
//     connectionErrors: 0,
//     lastConnectionTime: 1234567890,
//     lastDisconnectionTime: null,
//     uptime: 3600000
//   },
//   publish: {
//     totalPublished: 100,
//     publishedByQueue: { 'my_queue': 50, 'other_queue': 50 },
//     publishedByExchange: { 'events': 30 },
//     publishErrors: 0,
//     publishRetries: 2,
//     totalBytesPublished: 102400,
//     averageMessageSize: 1024
//   },
//   consume: {
//     totalConsumed: 80,
//     consumedByQueue: { 'my_queue': 80 },
//     consumeErrors: 2,
//     consumeRetries: 5,
//     requeued: 1,
//     sentToDlq: 1,
//     averageProcessingTime: 150,
//     minProcessingTime: 50,
//     maxProcessingTime: 500,
//     errorRate: 0.024
//   },
//   queue: {
//     totalAsserted: 5,
//     totalDeleted: 1,
//     totalPurged: 2
//   },
//   exchange: {
//     totalAsserted: 3,
//     totalDeleted: 0,
//     totalBindings: 10
//   }
// }
```

#### `resetMetrics(): void`

Reset all metrics to zero.

```javascript
client.resetMetrics();
```

## Advanced Usage

### Custom Correlation ID Generator

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  correlationIdGenerator: () => {
    return `req-${Date.now()}-${crypto.randomUUID()}`;
  },
});
```

### Manual Message Acknowledgment

```javascript
await client.consume(
  'my_queue',
  async (msg) => {
    try {
      await processMessage(msg);
      client.channel.ack(msg); // Manual ack
    } catch (error) {
      client.channel.nack(msg, false, true); // Requeue
    }
  },
  { noAck: false }
);
```

### Message Expiration

```javascript
// Set expiration on publish
await client.publish('queue', data, {
  expiration: '60000', // 60 seconds
});

// Set TTL on queue
await client.assertQueue('queue', {
  arguments: {
    'x-message-ttl': 60000, // All messages expire after 60s
  },
});
```

### Priority Queues

```javascript
await client.publish('queue', data, {
  priority: 10, // Higher priority (0-255)
});
```

### Message Headers

```javascript
await client.publish('queue', data, {
  headers: {
    'x-user-id': '123',
    'x-request-id': 'req-456',
    'x-trace-id': 'trace-789',
  },
});
```

### Conditional Consumption

```javascript
// Only consume messages with specific headers
await client.bindQueue('queue', 'exchange', '', {
  'x-match': 'all',
  priority: 'high',
  type: 'order',
});
```

## Best Practices

### 1. Connection Management

✅ **Do:**

```javascript
// Create client once, reuse it
const client = new RabbitMQClient(process.env.AMQP_URL);
await client.connect();

// Use throughout your application
```

❌ **Don't:**

```javascript
// Don't create new client for each operation
async function publish() {
  const client = new RabbitMQClient('amqp://localhost');
  await client.connect();
  await client.publish('queue', data);
  await client.close();
}
```

### 2. Error Handling

✅ **Do:**

```javascript
await client.consume('queue', async (msg) => {
  try {
    await processMessage(msg);
  } catch (error) {
    // Log error, metrics will track it
    logger.error({ error, msg }, 'Failed to process message');
    // Message will be retried or sent to DLQ automatically
    throw error; // Re-throw to trigger retry/DLQ
  }
});
```

❌ **Don't:**

```javascript
await client.consume('queue', async (msg) => {
  await processMessage(msg); // If this throws, message is lost
});
```

### 3. Queue Configuration

✅ **Do:**

```javascript
// Use durable queues in production
await client.assertQueue('orders', {
  durable: true, // Survive broker restart
  dlq: true, // Enable DLQ for failed messages
});
```

❌ **Don't:**

```javascript
// Don't use non-durable queues for important data
await client.assertQueue('orders', {
  durable: false, // Lost on broker restart
});
```

### 4. Prefetch Settings

✅ **Do:**

```javascript
// Set prefetch based on processing time
await client.consume('queue', handler, {
  prefetch: 10, // Process 10 messages concurrently
});
```

❌ **Don't:**

```javascript
// Don't set prefetch too high
await client.consume('queue', handler, {
  prefetch: 1000, // Too many unacknowledged messages
});
```

### 5. Monitoring

✅ **Do:**

```javascript
// Export metrics regularly
setInterval(() => {
  const metrics = client.getMetrics();
  exportToPrometheus(metrics);
}, 60000); // Every minute

// Use health checks
app.get('/health', async (req, res) => {
  const health = await client.healthCheck();
  res.json(health);
});
```

### 6. Graceful Shutdown

✅ **Do:**

```javascript
// Client handles SIGTERM/SIGINT automatically
// Or handle manually:
process.on('SIGTERM', async () => {
  await client.close();
  process.exit(0);
});
```

## Examples

See [examples/](./examples/) directory for complete examples:

- **basic.js** - Simple publish/consume example
- **with-dlq.js** - Dead Letter Queue setup
- **with-prometheus.js** - Prometheus metrics integration

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import RabbitMQClient, {
  RabbitMQClientOptions,
  PublishOptions,
  ConsumeOptions,
  HealthCheckResult,
  Metrics,
} from 'rabbitmq-production-ready';

const options: RabbitMQClientOptions = {
  autoReconnect: true,
  dlq: {
    enabled: true,
  },
};

const client = new RabbitMQClient('amqp://localhost', options);

await client.connect();

const publishOptions: PublishOptions = {
  persistent: true,
  correlationId: 'custom-id',
};

await client.publish('queue', { data: 'Hello' }, publishOptions);

const health: HealthCheckResult = await client.healthCheck();
const metrics: Metrics = client.getMetrics();
```

## Events

The client extends EventEmitter and emits the following events:

```javascript
// Connection events
client.on('connected', () => {
  console.log('Connected to RabbitMQ');
});

client.on('reconnect', () => {
  console.log('Reconnected after disconnection');
});

client.on('ready', () => {
  console.log('Client ready for operations');
});

client.on('disconnected', () => {
  console.log('Connection closed');
});

// Error events
client.on('error', (error) => {
  console.error('RabbitMQ error:', error);
});

client.on('channel-error', (error) => {
  console.error('Channel error:', error);
});

// Reconnection events
client.on('reconnecting', ({ attempt, delay }) => {
  console.log(`Reconnecting (attempt ${attempt}) in ${delay}ms`);
});

client.on('reconnect-failed', ({ attempt, error }) => {
  console.error(`Reconnect failed (attempt ${attempt}):`, error);
});

client.on('reconnect-max-attempts-reached', ({ attempts, maxAttempts }) => {
  console.error(`Max reconnect attempts (${maxAttempts}) reached`);
});

// Message events
client.on('message-returned', (msg) => {
  console.log('Message returned (no route):', msg);
});

client.on('channel-drain', () => {
  console.log('Channel drained (ready for more messages)');
});

// Shutdown event
client.on('close', () => {
  console.log('Client closed');
});
```

## Troubleshooting

### Connection Issues

**Problem:** Client cannot connect to RabbitMQ

**Solutions:**

- Verify RabbitMQ is running: `rabbitmqctl status`
- Check connection string format: `amqp://user:password@host:port/vhost`
- Ensure network connectivity and firewall rules
- Check RabbitMQ logs: `tail -f /var/log/rabbitmq/rabbitmq.log`
- Verify credentials are correct
- Check if RabbitMQ is listening on expected port (default: 5672)

### Messages Not Consuming

**Problem:** Messages are published but not consumed

**Solutions:**

- Verify consumer is started: `client.getAllConsumers()`
- Check queue exists: `await client.getQueueInfo('queue_name')`
- Ensure handler doesn't throw unhandled errors
- Check RabbitMQ management UI for queue status
- Verify prefetch is not blocking (too many unacknowledged messages)
- Check if consumer was stopped: `client.stopConsuming()`

### High Memory Usage

**Problem:** Client consumes too much memory

**Solutions:**

- Reduce `prefetch` value in consume options
- Enable `noAck: true` if message acknowledgment is not needed
- Monitor metrics: `client.getMetrics()`
- Check for message accumulation in queues
- Process messages faster or increase consumer instances
- Use message TTL to prevent queue buildup

### DLQ Not Working

**Problem:** Failed messages not sent to DLQ

**Solutions:**

- Ensure DLQ is enabled: `dlq: { enabled: true }`
- Verify DLQ is created: `await client.assertDlq('queue_name')`
- Check retry count doesn't exceed `maxRetries`
- Verify DLX exchange exists
- Check queue has DLQ arguments: `await client.getQueueInfo('queue_name')`
- Ensure handler throws error (not silently fails)

### Reconnection Issues

**Problem:** Client doesn't reconnect after disconnection

**Solutions:**

- Verify `autoReconnect: true` (enabled by default)
- Check `maxReconnectAttempts` is not too low
- Monitor connection events: `client.on('reconnect', ...)`
- Check network stability
- Verify RabbitMQ server is accessible
- Check logs for reconnection errors

### Performance Issues

**Problem:** Slow message processing

**Solutions:**

- Increase `prefetch` value (but not too high)
- Process messages in parallel (multiple consumers)
- Optimize message handler code
- Use `noAck: true` if acknowledgment not needed
- Monitor metrics to identify bottlenecks
- Consider using exchanges for better routing

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Security

For security vulnerabilities, please see [SECURITY.md](./SECURITY.md).

## License

MIT

## Links

- [GitHub Repository](https://github.com/esurkov1/rabbitmq-production-ready)
- [NPM Package](https://www.npmjs.com/package/rabbitmq-production-ready)
- [Issues](https://github.com/esurkov1/rabbitmq-production-ready/issues)
