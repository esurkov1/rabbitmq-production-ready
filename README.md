# RabbitMQ Production-Ready Client

[![npm version](https://img.shields.io/npm/v/rabbitmq-production-ready.svg)](https://www.npmjs.com/package/rabbitmq-production-ready)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/rabbitmq-production-ready.svg)](https://nodejs.org/)
[![GitHub](https://img.shields.io/github/stars/esurkov1/rabbitmq-production-ready.svg)](https://github.com/esurkov1/rabbitmq-production-ready)

**🇷🇺 [Русская версия документации](README.ru.md)**

Production-ready RabbitMQ client for Node.js with auto-reconnect, retry logic, DLQ support, metrics, health checks, and comprehensive error handling.

## Features

- ✅ **Auto-reconnect** with exponential backoff
- ✅ **Retry logic** for publish and consume operations
- ✅ **Dead Letter Queue (DLQ)** support
- ✅ **Structured logging** with Pino
- ✅ **Metrics** collection
- ✅ **Health checks**
- ✅ **Graceful shutdown**
- ✅ **Correlation IDs** for message tracking
- ✅ **TypeScript** support
- ✅ **Hooks** for Prometheus integration

## Installation

```bash
npm install rabbitmq-production-ready
```

## Quick Start

```javascript
const RabbitMQClient = require('rabbitmq-production-ready');

const client = new RabbitMQClient('amqp://localhost');

// Connect
await client.connect();

// Publish a message
await client.publish('my_queue', { data: 'Hello World' });

// Consume messages
await client.consume('my_queue', async (msg) => {
  const content = JSON.parse(msg.content.toString());
  console.log('Received:', content);
});

// Health check
const health = await client.healthCheck();
console.log(health.status); // 'healthy' | 'unhealthy' | 'degraded'

// Get metrics
const metrics = client.getMetrics();
console.log(metrics);
```

## Configuration

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  // Logging
  logger: pino({ level: 'info' }),
  logLevel: 'info',

  // Auto-reconnect
  autoReconnect: true,
  maxReconnectAttempts: Infinity,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectMultiplier: 2,

  // Retry
  publishRetry: {
    enabled: true,
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    multiplier: 2,
  },
  consumeRetry: {
    enabled: true,
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    multiplier: 2,
  },

  // Dead Letter Queue
  dlq: {
    enabled: false, // disabled by default
    exchange: 'dlx',
    queuePrefix: 'dlq',
    ttl: null,
  },

  // Graceful shutdown
  shutdownTimeout: 10000,

  // Hooks for Prometheus integration
  hooks: {
    onPublish: (data) => {
      // data: { queue, exchange, messageSize, duration, correlationId }
      prometheusCounter.inc();
    },
    onConsume: (data) => {
      // data: { queue, processingTime, correlationId, retryCount }
      prometheusHistogram.observe(data.processingTime);
    },
    onError: (data) => {
      // data: { type, error, queue, exchange, correlationId }
      prometheusErrorCounter.inc();
    },
    onConnectionChange: (data) => {
      // data: { connected, wasReconnect }
      prometheusGauge.set(data.connected ? 1 : 0);
    },
  },
});
```

## API Reference

### Connection Management

#### `connect()`

Connect to RabbitMQ.

```javascript
await client.connect();
```

#### `close()`

Gracefully close connection and stop all consumers.

```javascript
await client.close();
```

#### `isConnected()`

Check if client is connected.

```javascript
const connected = client.isConnected();
```

#### `waitForConnection(timeout?, interval?)`

Wait for connection with timeout.

```javascript
await client.waitForConnection(30000, 100);
```

#### `getConnectionInfo()`

Get connection information.

```javascript
const info = client.getConnectionInfo();
// {
//   connected: true,
//   connectionString: 'amqp://localhost',
//   reconnectAttempts: 0,
//   autoReconnect: true,
//   ...
// }
```

### Publishing

#### `publish(queue, message, options?)`

Publish message to queue.

```javascript
await client.publish(
  'my_queue',
  { data: 'Hello' },
  {
    persistent: true,
    correlationId: 'custom-id',
    retry: true,
  }
);
```

#### `publishToExchange(exchange, routingKey, message, options?)`

Publish message through exchange.

```javascript
await client.publishToExchange('my_exchange', 'routing.key', { data: 'Hello' });
```

### Consuming

#### `consume(queue, handler, options?)`

Start consuming messages from queue.

```javascript
const consumerTag = await client.consume(
  'my_queue',
  async (msg) => {
    const content = JSON.parse(msg.content.toString());
    // Process message
  },
  {
    prefetch: 10,
    maxRetries: 3,
    retry: true,
  }
);
```

#### `stopConsuming(queue)`

Stop consuming messages from queue.

```javascript
await client.stopConsuming('my_queue');
```

#### `getAllConsumers()`

Get list of all active consumers.

```javascript
const consumers = client.getAllConsumers();
// [{ queue: 'my_queue', consumerTag: '...' }]
```

### Queue Management

#### `assertQueue(queue, options?)`

Create or verify queue exists.

```javascript
const queueInfo = await client.assertQueue('my_queue', {
  durable: true,
  dlq: true, // Enable DLQ for this queue
});
```

#### `deleteQueue(queue, options?)`

Delete queue.

```javascript
await client.deleteQueue('my_queue', { ifUnused: true });
```

#### `purgeQueue(queue)`

Purge all messages from queue.

```javascript
await client.purgeQueue('my_queue');
```

#### `getQueueInfo(queue)`

Get queue information.

```javascript
const info = await client.getQueueInfo('my_queue');
// { queue: 'my_queue', messageCount: 10, consumerCount: 1 }
```

### Exchange Management

#### `assertExchange(exchange, type, options?)`

Create or verify exchange exists.

```javascript
await client.assertExchange('my_exchange', 'topic', { durable: true });
```

#### `deleteExchange(exchange, options?)`

Delete exchange.

```javascript
await client.deleteExchange('my_exchange');
```

#### `bindQueue(queue, exchange, routingKey, args?)`

Bind queue to exchange.

```javascript
await client.bindQueue('my_queue', 'my_exchange', 'routing.key');
```

#### `unbindQueue(queue, exchange, routingKey, args?)`

Unbind queue from exchange.

```javascript
await client.unbindQueue('my_queue', 'my_exchange', 'routing.key');
```

#### `getExchangeInfo(exchange)`

Get exchange information.

```javascript
const info = await client.getExchangeInfo('my_exchange');
```

### Dead Letter Queue

#### `getDlqName(queue)`

Get DLQ name for queue.

```javascript
const dlqName = client.getDlqName('my_queue'); // 'dlq.my_queue'
```

#### `assertDlq(queue)`

Create or verify DLQ exists.

```javascript
await client.assertDlq('my_queue');
```

#### `getDlqInfo(queue)`

Get DLQ information.

```javascript
const info = await client.getDlqInfo('my_queue');
```

#### `purgeDlq(queue)`

Purge DLQ.

```javascript
await client.purgeDlq('my_queue');
```

#### `deleteDlq(queue, options?)`

Delete DLQ.

```javascript
await client.deleteDlq('my_queue');
```

### Health & Metrics

#### `healthCheck()`

Perform health check.

```javascript
const health = await client.healthCheck();
// {
//   status: 'healthy',
//   timestamp: '2024-01-01T00:00:00.000Z',
//   checks: {
//     connection: { status: 'healthy', message: 'Connected' },
//     consumers: { status: 'healthy', count: 2, queues: ['queue1', 'queue2'] }
//   }
// }
```

#### `getMetrics()`

Get collected metrics.

```javascript
const metrics = client.getMetrics();
// {
//   connection: { totalConnections: 1, totalReconnects: 0, ... },
//   publish: { totalPublished: 100, publishErrors: 0, ... },
//   consume: { totalConsumed: 50, consumeErrors: 0, ... },
//   ...
// }
```

#### `resetMetrics()`

Reset all metrics.

```javascript
client.resetMetrics();
```

## Events

The client extends EventEmitter and emits the following events:

- `connected` - Connection established
- `reconnect` - Reconnected after disconnection
- `ready` - Client ready for operations
- `disconnected` - Connection closed
- `error` - Error occurred
- `close` - Client closed

## TypeScript Support

The library includes full TypeScript definitions:

```typescript
import RabbitMQClient, { RabbitMQClientOptions } from 'rabbitmq-production-ready';

const options: RabbitMQClientOptions = {
  autoReconnect: true,
  dlq: {
    enabled: true,
  },
};

const client = new RabbitMQClient('amqp://localhost', options);

await client.connect();
await client.publish('my_queue', { data: 'Hello' });
```

## Graceful Shutdown

The client automatically registers SIGTERM and SIGINT handlers for graceful shutdown. To disable this behavior:

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  registerShutdownHandlers: false,
});
```

## Troubleshooting

### Connection Issues

**Problem**: Client cannot connect to RabbitMQ

**Solutions**:

- Verify RabbitMQ is running: `rabbitmqctl status`
- Check connection string format: `amqp://user:password@host:port/vhost`
- Ensure network connectivity and firewall rules
- Check RabbitMQ logs: `tail -f /var/log/rabbitmq/rabbitmq.log`

### Messages Not Consuming

**Problem**: Messages are published but not consumed

**Solutions**:

- Verify consumer is started: `client.getAllConsumers()`
- Check queue exists: `await client.getQueueInfo('queue_name')`
- Ensure handler doesn't throw unhandled errors
- Check RabbitMQ management UI for queue status

### High Memory Usage

**Problem**: Client consumes too much memory

**Solutions**:

- Reduce `prefetch` value in consume options
- Enable `noAck: true` if message acknowledgment is not needed
- Monitor metrics: `client.getMetrics()`
- Check for message accumulation in queues

### DLQ Not Working

**Problem**: Failed messages not sent to DLQ

**Solutions**:

- Ensure DLQ is enabled: `dlq: { enabled: true }`
- Verify DLQ is created: `await client.assertDlq('queue_name')`
- Check retry count doesn't exceed `maxRetries`
- Verify DLX exchange exists

### Reconnection Issues

**Problem**: Client doesn't reconnect after disconnection

**Solutions**:

- Verify `autoReconnect: true` (enabled by default)
- Check `maxReconnectAttempts` is not too low
- Monitor connection events: `client.on('reconnect', ...)`
- Check network stability

## Examples

See [examples/](./examples/) directory for more examples.

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
