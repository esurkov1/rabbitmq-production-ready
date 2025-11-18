/**
 * MetricsCollector - Централизованный сбор метрик
 */
class MetricsCollector {
  constructor() {
    this.reset();
  }

  /**
   * Сброс всех метрик
   */
  reset() {
    this.connection = {
      totalConnections: 0,
      totalReconnects: 0,
      connectionErrors: 0,
      lastConnectionTime: null,
      lastDisconnectionTime: null,
    };

    this.publish = {
      totalPublished: 0,
      publishedByQueue: {},
      publishedByExchange: {},
      publishErrors: 0,
      publishRetries: 0,
      totalBytesPublished: 0,
    };

    this.consume = {
      totalConsumed: 0,
      consumedByQueue: {},
      consumeErrors: 0,
      consumeRetries: 0,
      requeued: 0,
      sentToDlq: 0,
      totalProcessingTime: 0,
      minProcessingTime: null,
      maxProcessingTime: null,
    };

    this.queue = {
      totalAsserted: 0,
      totalDeleted: 0,
      totalPurged: 0,
    };

    this.exchange = {
      totalAsserted: 0,
      totalDeleted: 0,
      totalBindings: 0,
    };
  }

  // ========== CONNECTION METRICS ==========

  incrementConnections() {
    this.connection.totalConnections++;
    this.connection.lastConnectionTime = Date.now();
  }

  incrementReconnects() {
    this.connection.totalReconnects++;
  }

  incrementConnectionErrors() {
    this.connection.connectionErrors++;
  }

  recordDisconnection() {
    this.connection.lastDisconnectionTime = Date.now();
  }

  // ========== PUBLISH METRICS ==========

  recordPublish(queue, exchange, messageSize) {
    this.publish.totalPublished++;
    this.publish.totalBytesPublished += messageSize;

    if (queue) {
      this.publish.publishedByQueue[queue] = (this.publish.publishedByQueue[queue] || 0) + 1;
    }

    if (exchange) {
      this.publish.publishedByExchange[exchange] =
        (this.publish.publishedByExchange[exchange] || 0) + 1;
    }
  }

  incrementPublishErrors() {
    this.publish.publishErrors++;
  }

  incrementPublishRetries() {
    this.publish.publishRetries++;
  }

  // ========== CONSUME METRICS ==========

  recordConsume(queue, processingTime) {
    this.consume.totalConsumed++;
    this.consume.totalProcessingTime += processingTime;
    this.consume.consumedByQueue[queue] = (this.consume.consumedByQueue[queue] || 0) + 1;

    // Min/Max processing time
    if (
      this.consume.minProcessingTime === null ||
      processingTime < this.consume.minProcessingTime
    ) {
      this.consume.minProcessingTime = processingTime;
    }

    if (
      this.consume.maxProcessingTime === null ||
      processingTime > this.consume.maxProcessingTime
    ) {
      this.consume.maxProcessingTime = processingTime;
    }
  }

  incrementConsumeErrors() {
    this.consume.consumeErrors++;
  }

  incrementConsumeRetries() {
    this.consume.consumeRetries++;
  }

  incrementRequeued() {
    this.consume.requeued++;
  }

  incrementSentToDlq() {
    this.consume.sentToDlq++;
  }

  // ========== QUEUE METRICS ==========

  incrementQueueAsserted() {
    this.queue.totalAsserted++;
  }

  incrementQueueDeleted() {
    this.queue.totalDeleted++;
  }

  incrementQueuePurged() {
    this.queue.totalPurged++;
  }

  // ========== EXCHANGE METRICS ==========

  incrementExchangeAsserted() {
    this.exchange.totalAsserted++;
  }

  incrementExchangeDeleted() {
    this.exchange.totalDeleted++;
  }

  incrementExchangeBindings() {
    this.exchange.totalBindings++;
  }

  // ========== GET METRICS ==========

  getMetrics() {
    const averageProcessingTime =
      this.consume.totalConsumed > 0
        ? this.consume.totalProcessingTime / this.consume.totalConsumed
        : null;

    const errorRate =
      this.consume.totalConsumed > 0
        ? this.consume.consumeErrors / (this.consume.totalConsumed + this.consume.consumeErrors)
        : 0;

    const averageMessageSize =
      this.publish.totalPublished > 0
        ? this.publish.totalBytesPublished / this.publish.totalPublished
        : 0;

    const uptime =
      this.connection.lastConnectionTime && this.connection.lastDisconnectionTime
        ? this.connection.lastDisconnectionTime - this.connection.lastConnectionTime
        : this.connection.lastConnectionTime
          ? Date.now() - this.connection.lastConnectionTime
          : null;

    return {
      connection: {
        ...this.connection,
        uptime,
      },
      publish: {
        ...this.publish,
        averageMessageSize,
      },
      consume: {
        ...this.consume,
        averageProcessingTime,
        errorRate,
      },
      queue: { ...this.queue },
      exchange: { ...this.exchange },
    };
  }
}

module.exports = MetricsCollector;
