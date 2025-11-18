# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-01

### Added
- Initial release
- Auto-reconnect with exponential backoff
- Retry logic for publish and consume operations
- Dead Letter Queue (DLQ) support
- Structured logging with Pino
- Metrics collection
- Health checks
- Graceful shutdown
- Correlation IDs for message tracking
- TypeScript support
- Hooks for Prometheus integration
- Connection management methods (waitForConnection, getConnectionInfo, getAllConsumers)
- Comprehensive error handling
- Configuration validation

### Features
- Publisher methods: `publish()`, `publishToExchange()`
- Consumer methods: `consume()`, `stopConsuming()`
- Queue management: `assertQueue()`, `deleteQueue()`, `purgeQueue()`, `getQueueInfo()`
- Exchange management: `assertExchange()`, `deleteExchange()`, `bindQueue()`, `unbindQueue()`, `getExchangeInfo()`
- DLQ management: `getDlqName()`, `assertDlq()`, `getDlqInfo()`, `purgeDlq()`, `deleteDlq()`
- Health and metrics: `healthCheck()`, `getMetrics()`, `resetMetrics()`

