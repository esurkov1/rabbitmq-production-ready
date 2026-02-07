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
console.log('ТЕСТИРОВАНИЕ ВСЕХ МЕТОДОВ RABBITMQ CLIENT');
console.log('='.repeat(80));
console.log(`Подключение: ${AMQP_HOST}:${AMQP_PORT}`);
console.log(`Exchange: ${AMQP_EXCHANGE}`);
console.log('='.repeat(80));
console.log();

const results = {
  passed: [],
  failed: [],
};

async function test(name, fn) {
  try {
    console.log(`[TEST] ${name}...`);
    await fn();
    console.log(`[✓] ${name} - PASSED`);
    results.passed.push(name);
    console.log();
  } catch (error) {
    console.error(`[✗] ${name} - FAILED`);
    console.error(`   Ошибка: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack.split('\n')[1]?.trim()}`);
    }
    results.failed.push({ name, error: error.message });
    console.log();
  }
}

async function main() {
  const client = new RabbitMQClient(connectionString, {
    logLevel: 'info',
    dlq: { enabled: true },
  });

  // ==================== CONNECTION TESTS ====================
  await test('connect() - Подключение к RabbitMQ', async () => {
    await client.connect();
    if (!client.isConnected()) {
      throw new Error('Соединение не установлено после connect()');
    }
  });

  await test('isConnected() - Проверка статуса подключения', async () => {
    const connected = client.isConnected();
    if (!connected) {
      throw new Error('isConnected() вернул false');
    }
  });

  await test('waitForConnection() - Ожидание подключения', async () => {
    await client.waitForConnection(5000, 100);
  });

  await test('getConnectionInfo() - Получение информации о подключении', async () => {
    const info = client.getConnectionInfo();
    if (!info || typeof info !== 'object') {
      throw new Error('getConnectionInfo() не вернул объект');
    }
    if (info.connected !== true) {
      throw new Error('getConnectionInfo() показывает disconnected');
    }
    console.log(`   Connected: ${info.connected}, Reconnect attempts: ${info.reconnectAttempts}`);
  });

  // ==================== QUEUE MANAGEMENT TESTS ====================
  const testQueue = 'test_queue_' + Date.now();
  const testQueue2 = 'test_queue_2_' + Date.now();

  await test('assertQueue() - Создание очереди', async () => {
    const result = await client.assertQueue(testQueue, { durable: true });
    if (!result) {
      throw new Error('assertQueue() не вернул результат');
    }
    console.log(`   Создана очередь: ${testQueue}`);
  });

  await test('getQueueInfo() - Получение информации об очереди', async () => {
    const info = await client.getQueueInfo(testQueue);
    if (!info || typeof info !== 'object') {
      throw new Error('getQueueInfo() не вернул объект');
    }
    console.log(`   Queue: ${testQueue}, Messages: ${info.messageCount || 0}`);
  });

  await test('purgeQueue() - Очистка очереди', async () => {
    await client.purgeQueue(testQueue);
    const info = await client.getQueueInfo(testQueue);
    console.log(`   Очередь очищена, сообщений: ${info.messageCount || 0}`);
  });

  // ==================== EXCHANGE MANAGEMENT TESTS ====================
  const testExchange = AMQP_EXCHANGE;
  const testExchange2 = 'test_exchange_' + Date.now();

  await test('assertExchange() - Создание exchange', async () => {
    const result = await client.assertExchange(testExchange, 'topic', { durable: true });
    if (!result) {
      throw new Error('assertExchange() не вернул результат');
    }
    console.log(`   Создан exchange: ${testExchange}`);
  });

  await test('assertExchange() - Создание второго exchange', async () => {
    await client.assertExchange(testExchange2, 'direct', { durable: false });
    console.log(`   Создан exchange: ${testExchange2}`);
  });

  await test('getExchangeInfo() - Получение информации об exchange', async () => {
    const info = await client.getExchangeInfo(testExchange);
    if (!info) {
      throw new Error('getExchangeInfo() не вернул результат');
    }
    console.log(`   Exchange: ${testExchange}`);
  });

  await test('bindQueue() - Привязка очереди к exchange', async () => {
    await client.assertQueue(testQueue2, { durable: true });
    await client.bindQueue(testQueue2, testExchange, 'test.routing.key');
    console.log(`   Очередь ${testQueue2} привязана к ${testExchange} с ключом 'test.routing.key'`);
  });

  await test('unbindQueue() - Отвязка очереди от exchange', async () => {
    await client.unbindQueue(testQueue2, testExchange, 'test.routing.key');
    console.log(`   Очередь ${testQueue2} отвязана от ${testExchange}`);
  });

  // ==================== PUBLISHING TESTS ====================
  await test('publish() - Публикация сообщения в очередь', async () => {
    const message = { test: 'message', timestamp: Date.now(), data: 'Hello from publish()' };
    const result = await client.publish(testQueue, message);
    if (result !== true) {
      throw new Error('publish() не вернул true');
    }
    console.log(`   Сообщение опубликовано в очередь ${testQueue}`);
  });

  await test('publish() - Публикация строки', async () => {
    const result = await client.publish(testQueue, 'Simple string message');
    if (result !== true) {
      throw new Error('publish() строки не вернул true');
    }
    console.log(`   Строка опубликована в очередь ${testQueue}`);
  });

  await test('publish() - Публикация Buffer', async () => {
    const buffer = Buffer.from(JSON.stringify({ type: 'buffer', data: 'test' }));
    const result = await client.publish(testQueue, buffer);
    if (result !== true) {
      throw new Error('publish() Buffer не вернул true');
    }
    console.log(`   Buffer опубликован в очередь ${testQueue}`);
  });

  await test('publishToExchange() - Публикация через exchange', async () => {
    const message = {
      test: 'exchange',
      timestamp: Date.now(),
      data: 'Hello from publishToExchange()',
    };
    const result = await client.publishToExchange(testExchange, 'test.routing.key', message);
    if (result !== true) {
      throw new Error('publishToExchange() не вернул true');
    }
    console.log(`   Сообщение опубликовано в exchange ${testExchange} с ключом 'test.routing.key'`);
  });

  // ==================== CONSUMING TESTS ====================
  let consumerTag = null;
  let receivedMessages = [];

  await test('consume() - Подписка на очередь', async () => {
    consumerTag = await client.consume(
      testQueue,
      async (msg) => {
        const content = msg.content.toString();
        receivedMessages.push(content);
        console.log(`   [CONSUMER] Получено сообщение: ${content.substring(0, 50)}...`);
      },
      { prefetch: 10 }
    );
    if (!consumerTag || typeof consumerTag !== 'string') {
      throw new Error('consume() не вернул consumerTag');
    }
    console.log(`   Consumer запущен с тегом: ${consumerTag}`);
    // Даем время на получение сообщений
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  await test('getAllConsumers() - Получение списка consumers', async () => {
    const consumers = client.getAllConsumers();
    if (!Array.isArray(consumers)) {
      throw new Error('getAllConsumers() не вернул массив');
    }
    if (consumers.length === 0) {
      throw new Error('getAllConsumers() вернул пустой массив');
    }
    console.log(`   Найдено consumers: ${consumers.length}`);
    consumers.forEach((c) => {
      console.log(`     - Queue: ${c.queue}, Tag: ${c.consumerTag}`);
    });
  });

  await test('stopConsuming() - Остановка consumer', async () => {
    await client.stopConsuming(testQueue);
    const consumers = client.getAllConsumers();
    const stillConsuming = consumers.some((c) => c.queue === testQueue);
    if (stillConsuming) {
      throw new Error('Consumer все еще активен после stopConsuming()');
    }
    console.log(`   Consumer для очереди ${testQueue} остановлен`);
  });

  // ==================== DLQ TESTS ====================
  const dlqTestQueue = 'dlq_test_queue_' + Date.now();

  await test('getDlqName() - Получение имени DLQ', async () => {
    const dlqName = client.getDlqName(dlqTestQueue);
    if (!dlqName || typeof dlqName !== 'string') {
      throw new Error('getDlqName() не вернул строку');
    }
    console.log(`   DLQ для ${dlqTestQueue}: ${dlqName}`);
  });

  await test('assertDlq() - Создание DLQ', async () => {
    await client.assertQueue(dlqTestQueue, { durable: true });
    const dlqInfo = await client.assertDlq(dlqTestQueue);
    if (!dlqInfo) {
      throw new Error('assertDlq() не вернул информацию');
    }
    console.log(`   DLQ создана для очереди ${dlqTestQueue}`);
  });

  await test('getDlqInfo() - Получение информации о DLQ', async () => {
    const dlqInfo = await client.getDlqInfo(dlqTestQueue);
    if (!dlqInfo) {
      throw new Error('getDlqInfo() не вернул информацию');
    }
    console.log(`   DLQ информация получена, сообщений: ${dlqInfo.messageCount || 0}`);
  });

  await test('purgeDlq() - Очистка DLQ', async () => {
    await client.purgeDlq(dlqTestQueue);
    console.log(`   DLQ для ${dlqTestQueue} очищена`);
  });

  // ==================== HEALTH & METRICS TESTS ====================
  await test('getMetrics() - Получение метрик', async () => {
    const metrics = client.getMetrics();
    if (!metrics || typeof metrics !== 'object') {
      throw new Error('getMetrics() не вернул объект');
    }
    console.log(`   Published: ${metrics.publish?.totalPublished || 0}`);
    console.log(`   Consumed: ${metrics.consume?.totalConsumed || 0}`);
    console.log(`   Connections: ${metrics.connection?.totalConnections || 0}`);
  });

  await test('getHealthStatus() - Получение статуса здоровья', async () => {
    const status = client.getHealthStatus();
    if (!status || typeof status !== 'object') {
      throw new Error('getHealthStatus() не вернул объект');
    }
    console.log(`   Status: ${status.status || 'unknown'}`);
  });

  await test('healthCheck() - Выполнение health check', async () => {
    const health = await client.healthCheck();
    if (!health || typeof health !== 'object') {
      throw new Error('healthCheck() не вернул объект');
    }
    if (!['healthy', 'unhealthy', 'degraded'].includes(health.status)) {
      throw new Error(`healthCheck() вернул неверный статус: ${health.status}`);
    }
    console.log(`   Health status: ${health.status}`);
    console.log(`   Connection: ${health.checks?.connection?.status || 'unknown'}`);
    console.log(`   Consumers: ${health.checks?.consumers?.count || 0}`);
  });

  await test('resetMetrics() - Сброс метрик', async () => {
    client.resetMetrics();
    const metrics = client.getMetrics();
    if (metrics.publish?.totalPublished !== 0) {
      throw new Error('Метрики не были сброшены');
    }
    console.log(`   Метрики сброшены`);
  });

  // ==================== CLEANUP ====================
  await test('deleteQueue() - Удаление очереди', async () => {
    await client.deleteQueue(testQueue);
    await client.deleteQueue(testQueue2);
    await client.deleteQueue(dlqTestQueue);
    console.log(`   Тестовые очереди удалены`);
  });

  await test('deleteDlq() - Удаление DLQ', async () => {
    await client.deleteDlq(dlqTestQueue);
    console.log(`   DLQ удалена`);
  });

  await test('deleteExchange() - Удаление exchange', async () => {
    await client.deleteExchange(testExchange2);
    console.log(`   Exchange ${testExchange2} удален`);
  });

  // ==================== CLOSE TEST ====================
  await test('close() - Закрытие соединения', async () => {
    await client.close();
    if (client.isConnected()) {
      throw new Error('Соединение все еще активно после close()');
    }
    console.log(`   Соединение закрыто`);
  });

  // ==================== RESULTS ====================
  console.log('='.repeat(80));
  console.log('РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
  console.log('='.repeat(80));
  console.log(`Всего тестов: ${results.passed.length + results.failed.length}`);
  console.log(`Пройдено: ${results.passed.length} ✓`);
  console.log(`Провалено: ${results.failed.length} ✗`);
  console.log();

  if (results.failed.length > 0) {
    console.log('ПРОВАЛЕННЫЕ ТЕСТЫ:');
    results.failed.forEach(({ name, error }) => {
      console.log(`  ✗ ${name}`);
      console.log(`    ${error}`);
    });
    console.log();
    process.exit(1);
  } else {
    console.log('ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО! ✓');
    console.log('='.repeat(80));
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
