# RabbitMQ Production-Ready Client

[![npm version](https://img.shields.io/npm/v/rabbitmq-production-ready.svg)](https://www.npmjs.com/package/rabbitmq-production-ready)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/rabbitmq-production-ready.svg)](https://nodejs.org/)
[![GitHub](https://img.shields.io/github/stars/esurkov1/rabbitmq-production-ready.svg)](https://github.com/esurkov1/rabbitmq-production-ready)

Production-ready клиент RabbitMQ для Node.js с автоматическим переподключением, логикой повторных попыток, поддержкой DLQ, метриками, проверками здоровья и комплексной обработкой ошибок.

## Возможности

- ✅ **Автоматическое переподключение** с экспоненциальной задержкой
- ✅ **Логика повторных попыток** для операций публикации и потребления
- ✅ **Поддержка Dead Letter Queue (DLQ)**
- ✅ **Структурированное логирование** с Pino
- ✅ **Сбор метрик**
- ✅ **Проверки здоровья**
- ✅ **Корректное завершение работы**
- ✅ **Correlation IDs** для отслеживания сообщений
- ✅ **Поддержка TypeScript**
- ✅ **Хуки** для интеграции с Prometheus

## Установка

```bash
npm install rabbitmq-production-ready
```

## Быстрый старт

```javascript
const RabbitMQClient = require('rabbitmq-production-ready');

const client = new RabbitMQClient('amqp://localhost');

// Подключение
await client.connect();

// Публикация сообщения
await client.publish('my_queue', { data: 'Hello World' });

// Потребление сообщений
await client.consume('my_queue', async (msg) => {
  const content = JSON.parse(msg.content.toString());
  console.log('Получено:', content);
});

// Проверка здоровья
const health = await client.healthCheck();
console.log(health.status); // 'healthy' | 'unhealthy' | 'degraded'

// Получение метрик
const metrics = client.getMetrics();
console.log(metrics);
```

## Конфигурация

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  // Логирование
  logger: pino({ level: 'info' }),
  logLevel: 'info',

  // Автоматическое переподключение
  autoReconnect: true,
  maxReconnectAttempts: Infinity,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectMultiplier: 2,

  // Повторные попытки
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
    enabled: false, // по умолчанию отключено
    exchange: 'dlx',
    queuePrefix: 'dlq',
    ttl: null,
  },

  // Корректное завершение работы
  shutdownTimeout: 10000,

  // Хуки для интеграции с Prometheus
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

## Справочник API

### Управление подключением

#### `connect()`

Подключиться к RabbitMQ.

```javascript
await client.connect();
```

#### `close()`

Корректно закрыть подключение и остановить всех потребителей.

```javascript
await client.close();
```

#### `isConnected()`

Проверить, подключен ли клиент.

```javascript
const connected = client.isConnected();
```

#### `waitForConnection(timeout?, interval?)`

Ожидать подключения с таймаутом.

```javascript
await client.waitForConnection(30000, 100);
```

#### `getConnectionInfo()`

Получить информацию о подключении.

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

### Публикация

#### `publish(queue, message, options?)`

Опубликовать сообщение в очередь.

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

Опубликовать сообщение через exchange.

```javascript
await client.publishToExchange('my_exchange', 'routing.key', { data: 'Hello' });
```

### Потребление

#### `consume(queue, handler, options?)`

Начать потребление сообщений из очереди.

```javascript
const consumerTag = await client.consume(
  'my_queue',
  async (msg) => {
    const content = JSON.parse(msg.content.toString());
    // Обработать сообщение
  },
  {
    prefetch: 10,
    maxRetries: 3,
    retry: true,
  }
);
```

#### `stopConsuming(queue)`

Остановить потребление сообщений из очереди.

```javascript
await client.stopConsuming('my_queue');
```

#### `getAllConsumers()`

Получить список всех активных потребителей.

```javascript
const consumers = client.getAllConsumers();
// [{ queue: 'my_queue', consumerTag: '...' }]
```

### Управление очередями

#### `assertQueue(queue, options?)`

Создать или проверить существование очереди.

```javascript
const queueInfo = await client.assertQueue('my_queue', {
  durable: true,
  dlq: true, // Включить DLQ для этой очереди
});
```

#### `deleteQueue(queue, options?)`

Удалить очередь.

```javascript
await client.deleteQueue('my_queue', { ifUnused: true });
```

#### `purgeQueue(queue)`

Очистить все сообщения из очереди.

```javascript
await client.purgeQueue('my_queue');
```

#### `getQueueInfo(queue)`

Получить информацию об очереди.

```javascript
const info = await client.getQueueInfo('my_queue');
// { queue: 'my_queue', messageCount: 10, consumerCount: 1 }
```

### Управление Exchange

#### `assertExchange(exchange, type, options?)`

Создать или проверить существование exchange.

```javascript
await client.assertExchange('my_exchange', 'topic', { durable: true });
```

#### `deleteExchange(exchange, options?)`

Удалить exchange.

```javascript
await client.deleteExchange('my_exchange');
```

#### `bindQueue(queue, exchange, routingKey, args?)`

Привязать очередь к exchange.

```javascript
await client.bindQueue('my_queue', 'my_exchange', 'routing.key');
```

#### `unbindQueue(queue, exchange, routingKey, args?)`

Отвязать очередь от exchange.

```javascript
await client.unbindQueue('my_queue', 'my_exchange', 'routing.key');
```

#### `getExchangeInfo(exchange)`

Получить информацию об exchange.

```javascript
const info = await client.getExchangeInfo('my_exchange');
```

### Dead Letter Queue

#### `getDlqName(queue)`

Получить имя DLQ для очереди.

```javascript
const dlqName = client.getDlqName('my_queue'); // 'dlq.my_queue'
```

#### `assertDlq(queue)`

Создать или проверить существование DLQ.

```javascript
await client.assertDlq('my_queue');
```

#### `getDlqInfo(queue)`

Получить информацию о DLQ.

```javascript
const info = await client.getDlqInfo('my_queue');
```

#### `purgeDlq(queue)`

Очистить DLQ.

```javascript
await client.purgeDlq('my_queue');
```

#### `deleteDlq(queue, options?)`

Удалить DLQ.

```javascript
await client.deleteDlq('my_queue');
```

### Здоровье и метрики

#### `healthCheck()`

Выполнить проверку здоровья.

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

Получить собранные метрики.

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

Сбросить все метрики.

```javascript
client.resetMetrics();
```

## События

Клиент расширяет EventEmitter и генерирует следующие события:

- `connected` - Подключение установлено
- `reconnect` - Переподключение после разрыва соединения
- `ready` - Клиент готов к операциям
- `disconnected` - Подключение закрыто
- `error` - Произошла ошибка
- `close` - Клиент закрыт

## Поддержка TypeScript

Библиотека включает полные определения типов TypeScript:

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

## Корректное завершение работы

Клиент автоматически регистрирует обработчики SIGTERM и SIGINT для корректного завершения работы. Чтобы отключить это поведение:

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  registerShutdownHandlers: false,
});
```

## Решение проблем

### Проблемы с подключением

**Проблема**: Клиент не может подключиться к RabbitMQ

**Решения**:

- Проверьте, что RabbitMQ запущен: `rabbitmqctl status`
- Проверьте формат строки подключения: `amqp://user:password@host:port/vhost`
- Убедитесь в сетевой связности и правилах файрвола
- Проверьте логи RabbitMQ: `tail -f /var/log/rabbitmq/rabbitmq.log`

### Сообщения не потребляются

**Проблема**: Сообщения публикуются, но не потребляются

**Решения**:

- Проверьте, что потребитель запущен: `client.getAllConsumers()`
- Проверьте существование очереди: `await client.getQueueInfo('queue_name')`
- Убедитесь, что обработчик не выбрасывает необработанные ошибки
- Проверьте статус очереди в RabbitMQ management UI

### Высокое потребление памяти

**Проблема**: Клиент потребляет слишком много памяти

**Решения**:

- Уменьшите значение `prefetch` в опциях потребления
- Включите `noAck: true`, если подтверждение сообщений не требуется
- Мониторьте метрики: `client.getMetrics()`
- Проверьте накопление сообщений в очередях

### DLQ не работает

**Проблема**: Неудачные сообщения не отправляются в DLQ

**Решения**:

- Убедитесь, что DLQ включен: `dlq: { enabled: true }`
- Проверьте, что DLQ создан: `await client.assertDlq('queue_name')`
- Проверьте, что количество повторных попыток не превышает `maxRetries`
- Убедитесь, что DLX exchange существует

### Проблемы с переподключением

**Проблема**: Клиент не переподключается после разрыва соединения

**Решения**:

- Убедитесь, что `autoReconnect: true` (включено по умолчанию)
- Проверьте, что `maxReconnectAttempts` не слишком низкий
- Мониторьте события подключения: `client.on('reconnect', ...)`
- Проверьте стабильность сети

## Примеры

См. директорию [examples/](./examples/) для дополнительных примеров.

## Вклад в проект

Вклад приветствуется! Пожалуйста, ознакомьтесь с [CONTRIBUTING.md](./CONTRIBUTING.md) для получения рекомендаций.

## Безопасность

Для сообщений об уязвимостях безопасности см. [SECURITY.md](./SECURITY.md).

## Лицензия

MIT

## Ссылки

- [Репозиторий GitHub](https://github.com/esurkov1/rabbitmq-production-ready)
- [Пакет NPM](https://www.npmjs.com/package/rabbitmq-production-ready)
- [Issues](https://github.com/esurkov1/rabbitmq-production-ready/issues)
