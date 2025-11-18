#!/bin/bash

set -e

echo "🐰 Starting RabbitMQ with Docker Compose..."

# Запускаем RabbitMQ
docker-compose -f docker-compose.test.yml up -d

# Ждем пока RabbitMQ станет готовым
echo "⏳ Waiting for RabbitMQ to be ready..."
timeout=60
elapsed=0
while [ $elapsed -lt $timeout ]; do
  if docker-compose -f docker-compose.test.yml exec -T rabbitmq rabbitmq-diagnostics -q ping > /dev/null 2>&1; then
    echo "✅ RabbitMQ is ready!"
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  echo "   Waiting... (${elapsed}s)"
done

if [ $elapsed -ge $timeout ]; then
  echo "❌ RabbitMQ failed to start within ${timeout}s"
  docker-compose -f docker-compose.test.yml down
  exit 1
fi

# Запускаем тесты
echo "🧪 Running tests..."
AMQP_URL="amqp://guest:guest@localhost:5672" npm test

# Сохраняем код выхода
TEST_EXIT_CODE=$?

# Останавливаем RabbitMQ
echo "🛑 Stopping RabbitMQ..."
docker-compose -f docker-compose.test.yml down

# Возвращаем код выхода тестов
exit $TEST_EXIT_CODE

