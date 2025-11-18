# RabbitMQ Production-Ready Client

[![npm version](https://img.shields.io/npm/v/rabbitmq-production-ready.svg)](https://www.npmjs.com/package/rabbitmq-production-ready)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/rabbitmq-production-ready.svg)](https://nodejs.org/)
[![GitHub](https://img.shields.io/github/stars/esurkov1/rabbitmq-production-ready.svg)](https://github.com/esurkov1/rabbitmq-production-ready)

**🇬🇧 [English Documentation](README.md)**

Production-ready клиент RabbitMQ для Node.js с автоматическим переподключением, логикой повторных попыток, поддержкой DLQ, метриками, проверками здоровья и комплексной обработкой ошибок.

## Содержание

- [Возможности](#возможности)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Почему эта библиотека?](#почему-эта-библиотека)
- [Основные концепции](#основные-концепции)
- [Руководство по конфигурации](#руководство-по-конфигурации)
- [Справочник API](#справочник-api)
- [Продвинутое использование](#продвинутое-использование)
- [Лучшие практики](#лучшие-практики)
- [Примеры](#примеры)
- [Поддержка TypeScript](#поддержка-typescript)
- [События](#события)
- [Решение проблем](#решение-проблем)
- [Вклад в проект](#вклад-в-проект)

## Возможности

- ✅ **Автоматическое переподключение** с экспоненциальной задержкой - Никогда не теряйте соединение
- ✅ **Логика повторных попыток** для операций публикации и потребления - Обработка временных сбоев
- ✅ **Поддержка Dead Letter Queue (DLQ)** - Перехват неудачных сообщений
- ✅ **Структурированное логирование** с Pino - Production-ready логирование
- ✅ **Сбор метрик** - Мониторинг паттернов обмена сообщениями
- ✅ **Проверки здоровья** - Готовые health endpoints для интеграции
- ✅ **Корректное завершение работы** - Чистое завершение приложения
- ✅ **Correlation IDs** - Отслеживание сообщений между сервисами
- ✅ **Поддержка TypeScript** - Полные определения типов включены
- ✅ **Хуки** для интеграции с Prometheus - Легкий экспорт метрик
- ✅ **Event-driven** - Реакция на изменения соединения
- ✅ **Управление очередями и Exchange** - Полный контроль над RabbitMQ

## Установка

```bash
npm install rabbitmq-production-ready
```

**Требования:**

- Node.js >= 18.0.0
- Сервер RabbitMQ (версия 3.x или новее)

## Быстрый старт

### Для начинающих

Запустите за 2 минуты:

```javascript
const RabbitMQClient = require('rabbitmq-production-ready');

async function main() {
  // 1. Создаем экземпляр клиента
  const client = new RabbitMQClient('amqp://localhost');

  try {
    // 2. Подключаемся к RabbitMQ
    await client.connect();
    console.log('✅ Подключено к RabbitMQ');

    // 3. Создаем очередь (если её нет)
    await client.assertQueue('my_queue', { durable: true });
    console.log('✅ Очередь готова');

    // 4. Публикуем сообщение
    await client.publish('my_queue', {
      userId: 123,
      action: 'user.created',
      timestamp: Date.now(),
    });
    console.log('✅ Сообщение опубликовано');

    // 5. Потребляем сообщения
    await client.consume('my_queue', async (msg) => {
      const content = JSON.parse(msg.content.toString());
      console.log('📨 Получено:', content);

      // Ваша бизнес-логика здесь
      // Обработка сообщения...

      // Сообщение автоматически подтверждается, если обработчик успешен
    });
    console.log('✅ Потребитель запущен');

    // Держим процесс запущенным
    process.on('SIGINT', async () => {
      console.log('Завершение работы...');
      await client.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

main();
```

**Запуск:**

```bash
node your-script.js
```

### Для профессионалов

Production-ready настройка с обработкой ошибок, DLQ и метриками:

```javascript
const RabbitMQClient = require('rabbitmq-production-ready');
const pino = require('pino');

const client = new RabbitMQClient(process.env.AMQP_URL, {
  // Логирование
  logger: pino({ level: process.env.LOG_LEVEL || 'info' }),

  // Автоматическое переподключение с экспоненциальной задержкой
  autoReconnect: true,
  maxReconnectAttempts: Infinity,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,

  // Конфигурация повторных попыток
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

  // Dead Letter Queue для неудачных сообщений
  dlq: {
    enabled: true,
    exchange: 'dlx',
    queuePrefix: 'dlq',
  },

  // Таймаут корректного завершения
  shutdownTimeout: 10000,

  // Хуки для метрик Prometheus
  hooks: {
    onPublish: (data) => {
      // Экспорт в Prometheus
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

// Обработчики событий соединения
client.on('connected', () => {
  console.log('Подключено к RabbitMQ');
});

client.on('reconnect', () => {
  console.log('Переподключено после разрыва соединения');
});

client.on('error', (error) => {
  console.error('Ошибка RabbitMQ:', error);
});

// Инициализация
async function init() {
  await client.connect();
  await client.assertQueue('orders', { durable: true, dlq: true });
  await client.assertDlq('orders');

  // Начинаем потребление
  await client.consume(
    'orders',
    async (msg) => {
      const order = JSON.parse(msg.content.toString());
      // Обработка заказа...
      await processOrder(order);
    },
    {
      prefetch: 10, // Обрабатывать до 10 сообщений параллельно
      maxRetries: 3,
    }
  );
}

init().catch(console.error);
```

## Почему эта библиотека?

### Проблемы, которые она решает

1. **Управление соединением**
   - ❌ Стандартные клиенты теряют соединения и не переподключаются
   - ✅ Автоматическое переподключение с экспоненциальной задержкой поддерживает соединение

2. **Обработка ошибок**
   - ❌ Неудачные сообщения теряются или вызывают бесконечные циклы
   - ✅ Логика повторных попыток + DLQ гарантирует доставку сообщений

3. **Наблюдаемость**
   - ❌ Нет видимости потока сообщений
   - ✅ Встроенные метрики и проверки здоровья

4. **Готовность к production**
   - ❌ Отсутствуют корректное завершение, correlation IDs, структурированное логирование
   - ✅ Все production функции включены

### Сравнение

| Функция                  | Стандартный клиент | Эта библиотека    |
| ------------------------ | ------------------ | ----------------- |
| Автопереподключение      | ❌                 | ✅                |
| Логика повторных попыток | ❌                 | ✅                |
| Поддержка DLQ            | Ручная             | ✅ Встроенная     |
| Метрики                  | ❌                 | ✅                |
| Проверки здоровья        | ❌                 | ✅                |
| Корректное завершение    | Ручное             | ✅ Автоматическое |
| Correlation IDs          | Ручные             | ✅ Автоматические |
| TypeScript               | ❌                 | ✅                |

## Основные концепции

### 1. Управление соединением

Клиент управляет соединениями автоматически:

```javascript
// Подключаемся один раз
await client.connect();

// Клиент обрабатывает переподключения автоматически
// Вы можете слушать события:
client.on('connected', () => console.log('Подключено'));
client.on('reconnect', () => console.log('Переподключено'));
client.on('disconnected', () => console.log('Отключено'));
```

### 2. Публикация сообщений

Публикуйте сообщения в очереди или через exchange:

```javascript
// Напрямую в очередь
await client.publish('my_queue', { data: 'Hello' });

// Через exchange
await client.publishToExchange('events', 'user.created', {
  userId: 123,
  action: 'created',
});
```

### 3. Потребление сообщений

Потребляйте сообщения с автоматическим подтверждением:

```javascript
await client.consume('my_queue', async (msg) => {
  // Обработка сообщения
  const data = JSON.parse(msg.content.toString());

  // Если обработчик успешен, сообщение подтверждается
  // Если обработчик выбрасывает ошибку, сообщение повторяется или отправляется в DLQ
});
```

### 4. Логика повторных попыток

Автоматические повторные попытки для неудачных операций:

```javascript
// Повтор публикации - повторяет, если публикация не удалась
await client.publish('queue', data, { retry: true });

// Повтор потребления - повторяет, если обработчик выбрасывает ошибку
await client.consume('queue', handler, {
  maxRetries: 3, // Повторить до 3 раз
  retry: true,
});
```

### 5. Dead Letter Queue

Неудачные сообщения попадают в DLQ:

```javascript
// Включаем DLQ
const client = new RabbitMQClient('amqp://localhost', {
  dlq: { enabled: true },
});

// Создаем очередь с DLQ
await client.assertQueue('orders', { dlq: true });

// Неудачные сообщения автоматически попадают в 'dlq.orders'
```

## Руководство по конфигурации

### Базовая конфигурация

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  // Минимальная конфигурация - использует разумные значения по умолчанию
});
```

### Продвинутая конфигурация

```javascript
const client = new RabbitMQClient('amqp://user:pass@host:5672/vhost', {
  // Логирование
  logger: pino({ level: 'info' }),
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'

  // Автоматическое переподключение
  autoReconnect: true, // По умолчанию: true
  maxReconnectAttempts: Infinity, // По умолчанию: Infinity
  initialReconnectDelay: 1000, // По умолчанию: 1000мс
  maxReconnectDelay: 30000, // По умолчанию: 30000мс
  reconnectMultiplier: 2, // По умолчанию: 2 (экспоненциальная задержка)

  // Повтор публикации
  publishRetry: {
    enabled: true, // По умолчанию: true
    maxAttempts: 3, // По умолчанию: 3
    initialDelay: 1000, // По умолчанию: 1000мс
    maxDelay: 10000, // По умолчанию: 10000мс
    multiplier: 2, // По умолчанию: 2
  },

  // Повтор потребления
  consumeRetry: {
    enabled: true, // По умолчанию: true
    maxAttempts: 3, // По умолчанию: 3
    initialDelay: 1000, // По умолчанию: 1000мс
    maxDelay: 10000, // По умолчанию: 10000мс
    multiplier: 2, // По умолчанию: 2
  },

  // Dead Letter Queue
  dlq: {
    enabled: false, // По умолчанию: false
    exchange: 'dlx', // По умолчанию: 'dlx'
    queuePrefix: 'dlq', // По умолчанию: 'dlq'
    ttl: null, // По умолчанию: null (без TTL)
  },

  // Корректное завершение работы
  shutdownTimeout: 10000, // По умолчанию: 10000мс

  // Обработчики завершения
  registerShutdownHandlers: true, // По умолчанию: true

  // Пользовательский генератор correlation ID
  correlationIdGenerator: () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  },

  // Хуки для внешних интеграций
  hooks: {
    onPublish: (data) => {
      // Вызывается после успешной публикации
      // data: { queue, exchange, routingKey?, messageSize, duration, correlationId }
    },
    onConsume: (data) => {
      // Вызывается после успешного потребления
      // data: { queue, processingTime, correlationId, retryCount }
    },
    onError: (data) => {
      // Вызывается при ошибках
      // data: { type: 'publish' | 'consume', error, queue?, exchange?, correlationId?, retryCount? }
    },
    onConnectionChange: (data) => {
      // Вызывается при изменениях соединения
      // data: { connected: boolean, wasReconnect?: boolean }
    },
  },
});
```

### Формат строки подключения

```
amqp://[username]:[password]@[host]:[port]/[vhost]
```

Примеры:

- `amqp://localhost` - Локально, учетные данные по умолчанию
- `amqp://guest:guest@localhost:5672` - Явные учетные данные
- `amqp://user:pass@rabbitmq.example.com:5672/production` - Полный URL
- `amqps://user:pass@rabbitmq.example.com:5671` - TLS соединение

## Справочник API

### Управление подключением

#### `connect(): Promise<void>`

Подключиться к RabbitMQ. Идемпотентно - безопасно вызывать несколько раз.

```javascript
await client.connect();
```

**Выбрасывает:** `Error` если подключение не удалось и автопереподключение отключено

#### `close(): Promise<void>`

Корректно закрыть соединение и остановить всех потребителей. Ожидает завершения операций.

```javascript
await client.close();
```

**Поведение:**

- Останавливает всех активных потребителей
- Ожидает завершения операций (до `shutdownTimeout`)
- Закрывает соединение и канал
- Генерирует событие `close`

#### `isConnected(): boolean`

Проверить, подключен ли клиент в данный момент.

```javascript
if (client.isConnected()) {
  await client.publish('queue', data);
}
```

#### `waitForConnection(timeout?: number, interval?: number): Promise<void>`

Ожидать установления соединения с таймаутом.

```javascript
try {
  await client.waitForConnection(30000, 100); // Таймаут 30с, проверка каждые 100мс
  console.log('Подключено!');
} catch (error) {
  console.error('Таймаут подключения');
}
```

**Параметры:**

- `timeout` (по умолчанию: 30000) - Максимальное время ожидания в миллисекундах
- `interval` (по умолчанию: 100) - Интервал проверки в миллисекундах

#### `getConnectionInfo(): object`

Получить подробную информацию о соединении.

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

### Публикация

#### `publish(queue: string, message: any, options?: PublishOptions): Promise<boolean>`

Опубликовать сообщение напрямую в очередь.

```javascript
// Простая публикация
await client.publish('my_queue', { data: 'Hello' });

// С опциями
await client.publish(
  'my_queue',
  { data: 'Hello' },
  {
    persistent: true, // Сообщение переживет перезапуск брокера
    correlationId: 'custom-id', // Пользовательский correlation ID
    retry: true, // Включить повтор при неудаче
    expiration: '60000', // TTL сообщения в миллисекундах
    priority: 5, // Приоритет сообщения (0-255)
    headers: {
      'x-custom-header': 'value',
    },
  }
);
```

**Параметры:**

- `queue` - Имя очереди
- `message` - Полезная нагрузка сообщения (объект, строка или Buffer)
- `options` - Опции публикации (см. amqplib Options.Publish)

**Возвращает:** `Promise<boolean>` - `true` если сообщение отправлено, `false` если канал заполнен

**Формат сообщения:**

- Объекты автоматически преобразуются в JSON
- Строки отправляются как есть
- Buffers отправляются как бинарные данные

#### `publishToExchange(exchange: string, routingKey: string, message: any, options?: PublishOptions): Promise<boolean>`

Опубликовать сообщение через exchange.

```javascript
// Topic exchange
await client.publishToExchange('events', 'user.created', {
  userId: 123,
  action: 'created',
});

// Direct exchange
await client.publishToExchange('orders', 'order.processed', orderData);

// Fanout exchange (routingKey игнорируется)
await client.publishToExchange('notifications', '', notificationData);
```

### Потребление

#### `consume(queue: string, handler: Function, options?: ConsumeOptions): Promise<string>`

Начать потребление сообщений из очереди.

```javascript
const consumerTag = await client.consume(
  'my_queue',
  async (msg) => {
    const content = JSON.parse(msg.content.toString());

    // Обработка сообщения
    await processMessage(content);

    // Сообщение автоматически подтверждается, если обработчик успешен
    // Если обработчик выбрасывает ошибку, сообщение повторяется или отправляется в DLQ
  },
  {
    prefetch: 10, // Обрабатывать до 10 сообщений параллельно
    maxRetries: 3, // Повторить до 3 раз при ошибке
    retry: true, // Включить логику повторных попыток
    requeue: true, // Возвращать в очередь при ошибке (если retry отключен)
    noAck: false, // Ручное подтверждение (по умолчанию: false)
  }
);
```

**Функция обработчика:**

- Получает объект `msg` из amqplib
- Если обработчик успешен, сообщение автоматически подтверждается
- Если обработчик выбрасывает ошибку, сообщение повторяется или отправляется в DLQ в зависимости от конфигурации

**Опции:**

- `prefetch` - Количество неподтвержденных сообщений для предварительной загрузки
- `maxRetries` - Максимальное количество попыток повтора (по умолчанию: из `consumeRetry.maxAttempts`)
- `retry` - Включить логику повторных попыток (по умолчанию: true)
- `requeue` - Возвращать сообщение в очередь при ошибке (по умолчанию: true)
- `noAck` - Отключить автоматическое подтверждение (по умолчанию: false)

**Возвращает:** `Promise<string>` - Тег потребителя

#### `stopConsuming(queue: string): Promise<void>`

Остановить потребление сообщений из очереди.

```javascript
await client.stopConsuming('my_queue');
```

#### `getAllConsumers(): Array<{queue: string, consumerTag: string}>`

Получить список всех активных потребителей.

```javascript
const consumers = client.getAllConsumers();
// [{ queue: 'my_queue', consumerTag: 'amq.ctag-...' }]
```

### Управление очередями

#### `assertQueue(queue: string, options?: AssertQueueOptions): Promise<QueueInfo>`

Создать или проверить существование очереди.

```javascript
const queueInfo = await client.assertQueue('my_queue', {
  durable: true, // Переживет перезапуск брокера
  exclusive: false, // Не эксклюзивна для соединения
  autoDelete: false, // Не удалять при неиспользовании
  dlq: true, // Включить DLQ (если dlq.enabled в конфиге)
  arguments: {
    'x-message-ttl': 60000, // TTL сообщений
    'x-max-length': 1000, // Максимальная длина очереди
  },
});
```

**Возвращает:** Объект с информацией об очереди

#### `deleteQueue(queue: string, options?: DeleteQueueOptions): Promise<DeleteQueueResult>`

Удалить очередь.

```javascript
await client.deleteQueue('my_queue', {
  ifUnused: true, // Удалять только если нет потребителей
  ifEmpty: true, // Удалять только если пуста
});
```

#### `purgeQueue(queue: string): Promise<PurgeQueueResult>`

Удалить все сообщения из очереди без удаления самой очереди.

```javascript
await client.purgeQueue('my_queue');
```

#### `getQueueInfo(queue: string): Promise<QueueInfo>`

Получить информацию об очереди (количество сообщений, количество потребителей и т.д.).

```javascript
const info = await client.getQueueInfo('my_queue');
// {
//   queue: 'my_queue',
//   messageCount: 10,
//   consumerCount: 1
// }
```

### Управление Exchange

#### `assertExchange(exchange: string, type: string, options?: AssertExchangeOptions): Promise<ExchangeInfo>`

Создать или проверить существование exchange.

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

**Типы Exchange:**

- `direct` - Маршрутизация на основе точного совпадения routing key
- `topic` - Маршрутизация на основе сопоставления с образцом
- `fanout` - Вещание во все привязанные очереди
- `headers` - Маршрутизация на основе заголовков сообщений

#### `deleteExchange(exchange: string, options?: DeleteExchangeOptions): Promise<void>`

Удалить exchange.

```javascript
await client.deleteExchange('my_exchange', {
  ifUnused: true, // Удалять только если нет привязанных очередей
});
```

#### `bindQueue(queue: string, exchange: string, routingKey: string, args?: object): Promise<void>`

Привязать очередь к exchange.

```javascript
// Topic привязка
await client.bindQueue('user_events', 'events', 'user.*');

// Direct привязка
await client.bindQueue('orders', 'orders', 'order.created');
```

#### `unbindQueue(queue: string, exchange: string, routingKey: string, args?: object): Promise<void>`

Отвязать очередь от exchange.

```javascript
await client.unbindQueue('user_events', 'events', 'user.*');
```

#### `getExchangeInfo(exchange: string): Promise<ExchangeInfo>`

Получить информацию об exchange.

```javascript
const info = await client.getExchangeInfo('my_exchange');
```

### Dead Letter Queue

#### `getDlqName(queue: string): string`

Получить имя DLQ для очереди.

```javascript
const dlqName = client.getDlqName('orders'); // 'dlq.orders'
```

#### `assertDlq(queue: string): Promise<QueueInfo>`

Создать или проверить существование DLQ для очереди.

```javascript
await client.assertDlq('orders');
```

#### `getDlqInfo(queue: string): Promise<QueueInfo>`

Получить информацию о DLQ.

```javascript
const dlqInfo = await client.getDlqInfo('orders');
console.log(`DLQ содержит ${dlqInfo.messageCount} сообщений`);
```

#### `purgeDlq(queue: string): Promise<PurgeQueueResult>`

Удалить все сообщения из DLQ.

```javascript
await client.purgeDlq('orders');
```

#### `deleteDlq(queue: string, options?: DeleteQueueOptions): Promise<DeleteQueueResult>`

Удалить DLQ.

```javascript
await client.deleteDlq('orders');
```

### Здоровье и метрики

#### `healthCheck(): Promise<HealthCheckResult>`

Выполнить проверку здоровья. Полезно для health endpoints.

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

// Использование в Express health endpoint
app.get('/health', async (req, res) => {
  const health = await client.healthCheck();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

#### `getMetrics(): Metrics`

Получить собранные метрики.

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

Сбросить все метрики до нуля.

```javascript
client.resetMetrics();
```

## Продвинутое использование

### Пользовательский генератор Correlation ID

```javascript
const client = new RabbitMQClient('amqp://localhost', {
  correlationIdGenerator: () => {
    return `req-${Date.now()}-${crypto.randomUUID()}`;
  },
});
```

### Ручное подтверждение сообщений

```javascript
await client.consume(
  'my_queue',
  async (msg) => {
    try {
      await processMessage(msg);
      client.channel.ack(msg); // Ручное подтверждение
    } catch (error) {
      client.channel.nack(msg, false, true); // Возврат в очередь
    }
  },
  { noAck: false }
);
```

### Истечение срока действия сообщений

```javascript
// Установить срок действия при публикации
await client.publish('queue', data, {
  expiration: '60000', // 60 секунд
});

// Установить TTL на очереди
await client.assertQueue('queue', {
  arguments: {
    'x-message-ttl': 60000, // Все сообщения истекают через 60с
  },
});
```

### Приоритетные очереди

```javascript
await client.publish('queue', data, {
  priority: 10, // Высокий приоритет (0-255)
});
```

### Заголовки сообщений

```javascript
await client.publish('queue', data, {
  headers: {
    'x-user-id': '123',
    'x-request-id': 'req-456',
    'x-trace-id': 'trace-789',
  },
});
```

### Условное потребление

```javascript
// Потреблять только сообщения с определенными заголовками
await client.bindQueue('queue', 'exchange', '', {
  'x-match': 'all',
  priority: 'high',
  type: 'order',
});
```

## Лучшие практики

### 1. Управление соединением

✅ **Правильно:**

```javascript
// Создайте клиент один раз, переиспользуйте его
const client = new RabbitMQClient(process.env.AMQP_URL);
await client.connect();

// Используйте по всему приложению
```

❌ **Неправильно:**

```javascript
// Не создавайте новый клиент для каждой операции
async function publish() {
  const client = new RabbitMQClient('amqp://localhost');
  await client.connect();
  await client.publish('queue', data);
  await client.close();
}
```

### 2. Обработка ошибок

✅ **Правильно:**

```javascript
await client.consume('queue', async (msg) => {
  try {
    await processMessage(msg);
  } catch (error) {
    // Логируйте ошибку, метрики отследят её
    logger.error({ error, msg }, 'Не удалось обработать сообщение');
    // Сообщение будет повторено или отправлено в DLQ автоматически
    throw error; // Повторно выбросить для запуска retry/DLQ
  }
});
```

❌ **Неправильно:**

```javascript
await client.consume('queue', async (msg) => {
  await processMessage(msg); // Если это выбрасывает ошибку, сообщение теряется
});
```

### 3. Конфигурация очереди

✅ **Правильно:**

```javascript
// Используйте долговечные очереди в production
await client.assertQueue('orders', {
  durable: true, // Переживет перезапуск брокера
  dlq: true, // Включить DLQ для неудачных сообщений
});
```

❌ **Неправильно:**

```javascript
// Не используйте недолговечные очереди для важных данных
await client.assertQueue('orders', {
  durable: false, // Потеряно при перезапуске брокера
});
```

### 4. Настройки Prefetch

✅ **Правильно:**

```javascript
// Установите prefetch на основе времени обработки
await client.consume('queue', handler, {
  prefetch: 10, // Обрабатывать 10 сообщений параллельно
});
```

❌ **Неправильно:**

```javascript
// Не устанавливайте prefetch слишком высоким
await client.consume('queue', handler, {
  prefetch: 1000, // Слишком много неподтвержденных сообщений
});
```

### 5. Мониторинг

✅ **Правильно:**

```javascript
// Экспортируйте метрики регулярно
setInterval(() => {
  const metrics = client.getMetrics();
  exportToPrometheus(metrics);
}, 60000); // Каждую минуту

// Используйте проверки здоровья
app.get('/health', async (req, res) => {
  const health = await client.healthCheck();
  res.json(health);
});
```

### 6. Корректное завершение

✅ **Правильно:**

```javascript
// Клиент обрабатывает SIGTERM/SIGINT автоматически
// Или обрабатывайте вручную:
process.on('SIGTERM', async () => {
  await client.close();
  process.exit(0);
});
```

## Примеры

См. директорию [examples/](./examples/) для полных примеров:

- **basic.js** - Простой пример публикации/потребления
- **with-dlq.js** - Настройка Dead Letter Queue
- **with-prometheus.js** - Интеграция метрик Prometheus

## Поддержка TypeScript

Полные определения типов TypeScript включены:

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

## События

Клиент расширяет EventEmitter и генерирует следующие события:

```javascript
// События соединения
client.on('connected', () => {
  console.log('Подключено к RabbitMQ');
});

client.on('reconnect', () => {
  console.log('Переподключено после разрыва соединения');
});

client.on('ready', () => {
  console.log('Клиент готов к операциям');
});

client.on('disconnected', () => {
  console.log('Соединение закрыто');
});

// События ошибок
client.on('error', (error) => {
  console.error('Ошибка RabbitMQ:', error);
});

client.on('channel-error', (error) => {
  console.error('Ошибка канала:', error);
});

// События переподключения
client.on('reconnecting', ({ attempt, delay }) => {
  console.log(`Переподключение (попытка ${attempt}) через ${delay}мс`);
});

client.on('reconnect-failed', ({ attempt, error }) => {
  console.error(`Переподключение не удалось (попытка ${attempt}):`, error);
});

client.on('reconnect-max-attempts-reached', ({ attempts, maxAttempts }) => {
  console.error(`Достигнуто максимальное количество попыток переподключения (${maxAttempts})`);
});

// События сообщений
client.on('message-returned', (msg) => {
  console.log('Сообщение возвращено (нет маршрута):', msg);
});

client.on('channel-drain', () => {
  console.log('Канал освобожден (готов к новым сообщениям)');
});

// Событие завершения
client.on('close', () => {
  console.log('Клиент закрыт');
});
```

## Решение проблем

### Проблемы с подключением

**Проблема:** Клиент не может подключиться к RabbitMQ

**Решения:**

- Проверьте, что RabbitMQ запущен: `rabbitmqctl status`
- Проверьте формат строки подключения: `amqp://user:password@host:port/vhost`
- Убедитесь в сетевой связности и правилах файрвола
- Проверьте логи RabbitMQ: `tail -f /var/log/rabbitmq/rabbitmq.log`
- Убедитесь, что учетные данные правильные
- Проверьте, что RabbitMQ слушает на ожидаемом порту (по умолчанию: 5672)

### Сообщения не потребляются

**Проблема:** Сообщения публикуются, но не потребляются

**Решения:**

- Проверьте, что потребитель запущен: `client.getAllConsumers()`
- Проверьте существование очереди: `await client.getQueueInfo('queue_name')`
- Убедитесь, что обработчик не выбрасывает необработанные ошибки
- Проверьте статус очереди в RabbitMQ management UI
- Убедитесь, что prefetch не блокирует (слишком много неподтвержденных сообщений)
- Проверьте, не был ли остановлен потребитель: `client.stopConsuming()`

### Высокое потребление памяти

**Проблема:** Клиент потребляет слишком много памяти

**Решения:**

- Уменьшите значение `prefetch` в опциях потребления
- Включите `noAck: true`, если подтверждение сообщений не требуется
- Мониторьте метрики: `client.getMetrics()`
- Проверьте накопление сообщений в очередях
- Обрабатывайте сообщения быстрее или увеличьте количество экземпляров потребителей
- Используйте TTL сообщений для предотвращения накопления в очереди

### DLQ не работает

**Проблема:** Неудачные сообщения не отправляются в DLQ

**Решения:**

- Убедитесь, что DLQ включен: `dlq: { enabled: true }`
- Проверьте, что DLQ создан: `await client.assertDlq('queue_name')`
- Проверьте, что количество повторных попыток не превышает `maxRetries`
- Убедитесь, что DLX exchange существует
- Проверьте, что очередь имеет аргументы DLQ: `await client.getQueueInfo('queue_name')`
- Убедитесь, что обработчик выбрасывает ошибку (не молча терпит неудачу)

### Проблемы с переподключением

**Проблема:** Клиент не переподключается после разрыва соединения

**Решения:**

- Убедитесь, что `autoReconnect: true` (включено по умолчанию)
- Проверьте, что `maxReconnectAttempts` не слишком низкий
- Мониторьте события соединения: `client.on('reconnect', ...)`
- Проверьте стабильность сети
- Убедитесь, что сервер RabbitMQ доступен
- Проверьте логи на ошибки переподключения

### Проблемы с производительностью

**Проблема:** Медленная обработка сообщений

**Решения:**

- Увеличьте значение `prefetch` (но не слишком высоко)
- Обрабатывайте сообщения параллельно (несколько потребителей)
- Оптимизируйте код обработчика сообщений
- Используйте `noAck: true`, если подтверждение не требуется
- Мониторьте метрики для выявления узких мест
- Рассмотрите использование exchanges для лучшей маршрутизации

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
