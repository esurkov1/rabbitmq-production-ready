const RabbitMQClient = require('../lib/RabbitMQClient');

// Пример использования AsyncLocalStorage для трейсинга
const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();

async function main() {
  const AMQP_HOST = process.env.AMQP_HOST || 'localhost';
  const AMQP_PORT = process.env.AMQP_PORT || 5672;
  const AMQP_USER = process.env.AMQP_USER || 'guest';
  const AMQP_PASSWORD = process.env.AMQP_PASSWORD || 'guest';
  const AMQP_VHOST = process.env.AMQP_VHOST || '/';
  const connectionString = `amqp://${AMQP_USER}:${AMQP_PASSWORD}@${AMQP_HOST}:${AMQP_PORT}${AMQP_VHOST === '/' ? '' : '/' + encodeURIComponent(AMQP_VHOST)}`;

  const client = new RabbitMQClient(connectionString, {
    logLevel: 'info',
    // Включаем tracing
    tracing: {
      enabled: true,
      headerName: 'x-trace-id', // Имя заголовка для trace ID
      correlationIdHeader: 'x-correlation-id', // Имя заголовка для correlation ID
      // Функция для получения trace ID из контекста (например, из AsyncLocalStorage)
      getTraceContext: () => {
        return asyncLocalStorage.getStore()?.traceId;
      },
      // Функция для установки trace ID в контекст при получении сообщения
      setTraceContext: (traceId) => {
        asyncLocalStorage.enterWith({ traceId });
      },
      // Функция для генерации нового trace ID (если не найден в контексте)
      generateTraceId: () => {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      },
    },
  });

  try {
    await client.connect();
    console.log('✓ Подключено к RabbitMQ\n');

    const queue = 'tracing_test_queue';
    await client.assertQueue(queue, { durable: true });
    console.log(`✓ Очередь создана: ${queue}\n`);

    console.log('='.repeat(80));
    console.log('СПОСОБЫ ПЕРЕДАЧИ TRACE ID ПРИ ПУБЛИКАЦИИ');
    console.log('='.repeat(80));
    console.log();

    // ==================== СПОСОБ 1: Прямая передача через опции ====================
    console.log('1️⃣  СПОСОБ: Прямая передача traceId через опции');
    console.log('   Использование: publish(queue, message, { traceId: "my-trace-id" })');
    console.log();

    await client.publish(
      queue,
      { method: 1, data: 'Прямая передача traceId' },
      {
        traceId: 'trace-direct-12345',
        correlationId: 'corr-direct-12345',
      }
    );
    console.log('   ✓ Опубликовано с traceId: trace-direct-12345');

    await client.publishToExchange(
      'events',
      'test.key',
      { method: 1, data: 'Через exchange' },
      {
        traceId: 'trace-exchange-67890',
        correlationId: 'corr-exchange-67890',
      }
    );
    console.log('   ✓ Опубликовано через exchange с traceId: trace-exchange-67890');
    console.log();

    // ==================== СПОСОБ 2: Автоматическое получение из контекста ====================
    console.log('2️⃣  СПОСОБ: Автоматическое получение из контекста (AsyncLocalStorage)');
    console.log('   Использование: установить traceId в контекст перед публикацией');
    console.log();

    asyncLocalStorage.run({ traceId: 'trace-context-abc123' }, async () => {
      await client.publish(queue, { method: 2, data: 'Из контекста' });
      console.log('   ✓ Опубликовано с traceId из контекста: trace-context-abc123');

      await client.publishToExchange('events', 'test.key', {
        method: 2,
        data: 'Из контекста через exchange',
      });
      console.log('   ✓ Опубликовано через exchange с traceId из контекста: trace-context-abc123');
    });
    console.log();

    // ==================== СПОСОБ 3: Автоматическая генерация ====================
    console.log('3️⃣  СПОСОБ: Автоматическая генерация traceId');
    console.log('   Использование: библиотека автоматически сгенерирует traceId');
    console.log('   (если не передан явно и не найден в контексте)');
    console.log();

    // Выходим из контекста, чтобы traceId не был найден
    await client.publish(queue, { method: 3, data: 'Автогенерация' });
    console.log('   ✓ Опубликовано с автогенерированным traceId');

    await client.publishToExchange('events', 'test.key', {
      method: 3,
      data: 'Автогенерация через exchange',
    });
    console.log('   ✓ Опубликовано через exchange с автогенерированным traceId');
    console.log();

    // ==================== СПОСОБ 4: Комбинированный (контекст + переопределение) ====================
    console.log('4️⃣  СПОСОБ: Комбинированный (контекст + явное переопределение)');
    console.log('   Использование: traceId в опциях имеет приоритет над контекстом');
    console.log();

    asyncLocalStorage.run({ traceId: 'trace-context-override' }, async () => {
      // Явный traceId в опциях переопределит контекстный
      await client.publish(
        queue,
        { method: 4, data: 'Переопределение контекста' },
        {
          traceId: 'trace-explicit-override',
        }
      );
      console.log(
        '   ✓ Опубликовано с явным traceId (переопределяет контекст): trace-explicit-override'
      );
    });
    console.log();

    // ==================== ПРОВЕРКА: Потребление сообщений ====================
    console.log('='.repeat(80));
    console.log('ПРОВЕРКА: Потребление сообщений с автоматической установкой trace context');
    console.log('='.repeat(80));
    console.log();

    let messageCount = 0;
    await client.consume(queue, async (msg) => {
      messageCount++;
      const content = JSON.parse(msg.content.toString());
      const traceId = msg.properties.headers['x-trace-id'];
      const correlationId = msg.properties.headers['x-correlation-id'];

      console.log(`📨 Сообщение #${messageCount}:`);
      console.log(`   Метод: ${content.method}`);
      console.log(`   Trace ID: ${traceId}`);
      console.log(`   Correlation ID: ${correlationId}`);
      console.log(`   Данные: ${content.data}`);

      // Trace context автоматически установлен из заголовков
      const currentTraceId = asyncLocalStorage.getStore()?.traceId;
      console.log(`   Trace ID в контексте: ${currentTraceId || 'не установлен'}`);
      console.log();
    });

    // Ждем обработки всех сообщений
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('='.repeat(80));
    console.log('ИТОГИ');
    console.log('='.repeat(80));
    console.log();
    console.log('Все способы передачи trace ID:');
    console.log('  1. Прямая передача через options.traceId');
    console.log('  2. Автоматическое получение из контекста (getTraceContext)');
    console.log('  3. Автоматическая генерация (generateTraceId)');
    console.log('  4. Комбинированный (контекст + явное переопределение)');
    console.log();
    console.log('Приоритет trace ID:');
    console.log('  1. options.traceId (наивысший приоритет)');
    console.log('  2. getTraceContext() (если возвращает значение)');
    console.log('  3. generateTraceId() (если включен tracing)');
    console.log();

    await client.close();
    console.log('✓ Соединение закрыто');
  } catch (error) {
    console.error('❌ Ошибка:', error);
    await client.close();
    process.exit(1);
  }
}

main();
