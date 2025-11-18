const RabbitMQClient = require('../lib/RabbitMQClient');

// Пример использования AsyncLocalStorage для трейсинга
const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();

async function main() {
  const client = new RabbitMQClient('amqp://localhost', {
    // Включаем tracing
    tracing: {
      enabled: true,
      headerName: 'x-trace-id',
      correlationIdHeader: 'x-correlation-id',
      getTraceContext: () => {
        return asyncLocalStorage.getStore()?.traceId;
      },
      setTraceContext: (traceId) => {
        asyncLocalStorage.enterWith({ traceId });
      },
    },

    // Кастомный serializer (опционально)
    serializer: (message) => {
      if (Buffer.isBuffer(message)) {
        return message;
      }
      // Можно использовать другие форматы, например MessagePack
      return Buffer.from(JSON.stringify(message));
    },

    // Кастомный deserializer (опционально)
    deserializer: (buffer) => {
      try {
        return JSON.parse(buffer.toString());
      } catch (e) {
        return buffer.toString();
      }
    },
  });

  try {
    await client.connect();
    console.log('Connected');

    await client.assertQueue('traced_queue', { durable: true });

    // Устанавливаем trace context перед публикацией
    asyncLocalStorage.run({ traceId: 'trace-123' }, async () => {
      await client.publish('traced_queue', { data: 'test', timestamp: Date.now() });
      console.log('Published message with trace context');
    });

    // Потребляем сообщения - trace context будет автоматически установлен
    await client.consume('traced_queue', async (msg) => {
      // msg.parsedContent содержит десериализованное сообщение
      console.log('Received:', msg.parsedContent);

      // Trace context автоматически установлен из заголовков
      const currentTraceId = asyncLocalStorage.getStore()?.traceId;
      console.log('Current trace ID:', currentTraceId);

      // Correlation ID доступен в заголовках
      const correlationId = msg.properties.headers['x-correlation-id'];
      console.log('Correlation ID:', correlationId);
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
