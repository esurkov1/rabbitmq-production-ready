# Testing Guide

## Quick Start

### Unit Tests (No RabbitMQ Required)

```bash
npm test
```

These tests validate configuration, serialization, and basic functionality without requiring a RabbitMQ server.

### Integration Tests with Docker Compose

For full integration testing with a real RabbitMQ server:

```bash
# Option 1: Use the test script (recommended)
npm run test:docker

# Option 2: Manual setup
docker-compose -f docker-compose.test.yml up -d
npm run test:integration
docker-compose -f docker-compose.test.yml down
```

### Run All Tests

```bash
npm run test:all
```

This runs unit tests first, then integration tests with Docker.

## Test Structure

### Unit Tests (`test/basic.test.js`)

- Configuration validation
- Serializer/deserializer functionality
- Tracing configuration
- Correlation ID generation
- Metrics collection
- No RabbitMQ server required

### Integration Tests (`test/integration.test.js`)

- Connection management
- Message publishing and consuming
- Retry logic
- Dead Letter Queue
- Health checks
- Reconnection handling
- Requires RabbitMQ server

### Full Integration Tests (`test/integration-full.test.js`)

- All integration tests plus:
- Custom serializer/deserializer
- Trace ID propagation
- Trace context management
- Requires RabbitMQ server

## Docker Compose Setup

The `docker-compose.test.yml` file provides a RabbitMQ instance for testing:

```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - '5672:5672'
      - '15672:15672'
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
```

**Management UI:** http://localhost:15672 (guest/guest)

## CI/CD Testing

The GitHub Actions workflow automatically:
1. Runs linting and type checking
2. Runs unit tests
3. Starts RabbitMQ service
4. Runs integration tests

No manual setup required for CI/CD.

## Manual Testing

If you want to test manually with a local RabbitMQ:

```bash
# Start RabbitMQ (if not using Docker)
# brew install rabbitmq  # macOS
# sudo apt-get install rabbitmq-server  # Linux

# Or use Docker
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# Run tests
AMQP_URL=amqp://guest:guest@localhost:5672 npm test
```

## Test Environment Variables

- `AMQP_URL` - RabbitMQ connection string (default: `amqp://guest:guest@localhost:5672`)

## Troubleshooting

### RabbitMQ Not Available

If integration tests are skipped:

```
⚠️  RabbitMQ is not available. Integration tests will be skipped.
   Start RabbitMQ with: docker-compose -f docker-compose.test.yml up -d
```

**Solution:** Start RabbitMQ using Docker Compose or ensure it's running locally.

### Port Already in Use

If port 5672 is already in use:

```bash
# Check what's using the port
lsof -i :5672

# Or use a different port in docker-compose.test.yml
ports:
  - '5673:5672'  # Use 5673 on host
```

Then update `AMQP_URL`:
```bash
AMQP_URL=amqp://guest:guest@localhost:5673 npm test
```

### Docker Compose Issues

```bash
# Check if containers are running
docker-compose -f docker-compose.test.yml ps

# View logs
docker-compose -f docker-compose.test.yml logs

# Clean up
docker-compose -f docker-compose.test.yml down -v
```

