const RabbitMQClient = require('./lib/RabbitMQClient');

// Параметры подключения из переменных окружения
const AMQP_HOST = process.env.AMQP_HOST || 'localhost';
const AMQP_PORT = process.env.AMQP_PORT || 5672;
const AMQP_USER = process.env.AMQP_USER || 'guest';
const AMQP_PASSWORD = process.env.AMQP_PASSWORD || 'guest';
const AMQP_VHOST = process.env.AMQP_VHOST || '/';
const AMQP_EXCHANGE = process.env.AMQP_EXCHANGE || 'events';
const AMQP_PUBLISH_TIMEOUT_MS = parseInt(process.env.AMQP_PUBLISH_TIMEOUT_MS || '5000', 10);

// Формируем connection string
const connectionString = `amqp://${AMQP_USER}:${AMQP_PASSWORD}@${AMQP_HOST}:${AMQP_PORT}${AMQP_VHOST === '/' ? '' : '/' + encodeURIComponent(AMQP_VHOST)}`;

console.log('='.repeat(80));
console.log('ПРОВЕРКА СОСТОЯНИЯ RABBITMQ');
console.log('='.repeat(80));
console.log(`Подключение: ${AMQP_HOST}:${AMQP_PORT}`);
console.log(`VHost: ${AMQP_VHOST}`);
console.log(`Exchange: ${AMQP_EXCHANGE}`);
console.log('='.repeat(80));
console.log();

async function main() {
  const client = new RabbitMQClient(connectionString, {
    logLevel: 'info',
    dlq: { enabled: true },
  });

  try {
    // Подключение
    console.log('📡 Подключение к RabbitMQ...');
    await client.connect();
    console.log('✓ Подключено\n');

    // Создаем тестовые очереди
    const queues = [
      { name: 'test_queue_1', routingKey: 'test.key1' },
      { name: 'test_queue_2', routingKey: 'test.key2' },
      { name: 'test_queue_3', routingKey: 'test.key3' },
    ];

    console.log('📋 Создание очередей...');
    for (const queue of queues) {
      await client.assertQueue(queue.name, { durable: true });
      console.log(`  ✓ Очередь создана: ${queue.name}`);
    }
    console.log();

    // Создаем exchange
    console.log('🔄 Создание exchange...');
    await client.assertExchange(AMQP_EXCHANGE, 'topic', { durable: true });
    console.log(`  ✓ Exchange создан: ${AMQP_EXCHANGE}\n`);

    // Привязываем очереди к exchange
    console.log('🔗 Привязка очередей к exchange...');
    for (const queue of queues) {
      await client.bindQueue(queue.name, AMQP_EXCHANGE, queue.routingKey);
      console.log(`  ✓ ${queue.name} → ${AMQP_EXCHANGE} (${queue.routingKey})`);
    }
    console.log();

    // Публикуем сообщения напрямую в очереди
    console.log('📤 Публикация сообщений в очереди...');
    for (let i = 0; i < queues.length; i++) {
      const queue = queues[i];
      const messages = [
        {
          type: 'direct',
          queue: queue.name,
          message: `Message 1 for ${queue.name}`,
          timestamp: Date.now(),
        },
        {
          type: 'direct',
          queue: queue.name,
          message: `Message 2 for ${queue.name}`,
          timestamp: Date.now(),
        },
        {
          type: 'direct',
          queue: queue.name,
          message: `Message 3 for ${queue.name}`,
          timestamp: Date.now(),
        },
      ];

      for (const msg of messages) {
        await client.publish(queue.name, msg);
      }
      console.log(`  ✓ Опубликовано 3 сообщения в ${queue.name}`);
    }
    console.log();

    // Публикуем сообщения через exchange
    console.log('📤 Публикация сообщений через exchange...');
    for (const queue of queues) {
      const messages = [
        {
          type: 'exchange',
          exchange: AMQP_EXCHANGE,
          routingKey: queue.routingKey,
          message: `Exchange message 1 for ${queue.routingKey}`,
          timestamp: Date.now(),
        },
        {
          type: 'exchange',
          exchange: AMQP_EXCHANGE,
          routingKey: queue.routingKey,
          message: `Exchange message 2 for ${queue.routingKey}`,
          timestamp: Date.now(),
        },
      ];

      for (const msg of messages) {
        await client.publishToExchange(AMQP_EXCHANGE, queue.routingKey, msg);
      }
      console.log(`  ✓ Опубликовано 2 сообщения через ${AMQP_EXCHANGE} → ${queue.routingKey}`);
    }
    console.log();

    // Небольшая задержка для обработки
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Проверяем состояние очередей
    console.log('='.repeat(80));
    console.log('ПРОВЕРКА СОСТОЯНИЯ ОЧЕРЕДЕЙ');
    console.log('='.repeat(80));

    let totalMessages = 0;
    for (const queue of queues) {
      const info = await client.getQueueInfo(queue.name);
      const messageCount = info.messageCount || 0;
      totalMessages += messageCount;

      console.log(`\n📦 Очередь: ${queue.name}`);
      console.log(`   Сообщений: ${messageCount}`);
      console.log(`   Routing Key: ${queue.routingKey}`);
      console.log(`   Durable: ${info.durable ? 'да' : 'нет'}`);
      console.log(`   Auto Delete: ${info.autoDelete ? 'да' : 'нет'}`);

      if (messageCount === 0) {
        console.log(`   ⚠️  ВНИМАНИЕ: Очередь пустая!`);
      } else {
        console.log(`   ✓ Очередь содержит сообщения`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`Всего сообщений во всех очередях: ${totalMessages}`);
    console.log('='.repeat(80));

    // Проверяем exchange
    console.log('\n🔄 Проверка exchange...');
    try {
      const exchangeInfo = await client.getExchangeInfo(AMQP_EXCHANGE);
      console.log(`  ✓ Exchange ${AMQP_EXCHANGE} существует`);
      console.log(`  Тип: topic`);
    } catch (error) {
      console.log(`  ✗ Ошибка при проверке exchange: ${error.message}`);
    }

    // Проверяем метрики
    console.log('\n📊 Метрики:');
    const metrics = client.getMetrics();
    console.log(`  Опубликовано всего: ${metrics.publish?.totalPublished || 0}`);
    console.log(`  Опубликовано по очередям:`, metrics.publish?.publishedByQueue || {});
    console.log(`  Опубликовано по exchange:`, metrics.publish?.publishedByExchange || {});
    console.log(`  Потреблено: ${metrics.consume?.totalConsumed || 0}`);

    // Health check
    console.log('\n🏥 Health Check:');
    const health = await client.healthCheck();
    console.log(`  Статус: ${health.status}`);
    console.log(`  Соединение: ${health.checks?.connection?.status || 'unknown'}`);
    console.log(`  Consumers: ${health.checks?.consumers?.count || 0}`);

    // Информация о подключении
    console.log('\n🔌 Информация о подключении:');
    const connInfo = client.getConnectionInfo();
    console.log(`  Подключено: ${connInfo.connected ? 'да' : 'нет'}`);
    console.log(`  Попыток переподключения: ${connInfo.reconnectAttempts || 0}`);
    console.log(`  Всего подключений: ${connInfo.totalConnections || 0}`);

    console.log('\n' + '='.repeat(80));
    console.log('ИТОГОВАЯ ПРОВЕРКА');
    console.log('='.repeat(80));

    const allQueuesHaveMessages = queues.every(async (queue) => {
      const info = await client.getQueueInfo(queue.name);
      return (info.messageCount || 0) > 0;
    });

    let queuesWithMessages = 0;
    for (const queue of queues) {
      const info = await client.getQueueInfo(queue.name);
      if ((info.messageCount || 0) > 0) {
        queuesWithMessages++;
      }
    }

    console.log(`\n✓ Создано очередей: ${queues.length}`);
    console.log(`✓ Очередей с сообщениями: ${queuesWithMessages}`);
    console.log(`✓ Exchange создан: ${AMQP_EXCHANGE}`);
    console.log(`✓ Всего сообщений: ${totalMessages}`);

    if (queuesWithMessages === queues.length && totalMessages > 0) {
      console.log('\n🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ УСПЕШНО!');
      console.log('   Все очереди созданы и содержат сообщения');
      console.log('   Exchange создан и работает');
    } else {
      console.log('\n⚠️  ВНИМАНИЕ: Некоторые очереди пустые или не созданы');
    }

    console.log('\n' + '='.repeat(80));

    // Закрываем соединение
    console.log('\n🛑 Закрытие соединения...');
    await client.close();
    console.log('✓ Соединение закрыто');
    console.log('\n💡 Проверьте очереди в RabbitMQ Management UI: http://localhost:15672');
    console.log('   Логин: guest / Пароль: guest\n');
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    await client.close();
    process.exit(1);
  }
}

main();
