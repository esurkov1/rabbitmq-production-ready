/**
 * HealthCheckManager - Управление health checks
 */
class HealthCheckManager {
  constructor(connectionManager, metrics, logger) {
    this.connectionManager = connectionManager;
    this.metrics = metrics;
    this.logger = logger;

    // Health status
    this.healthStatus = {
      status: 'unknown',
      lastCheck: null,
      details: {},
    };
  }

  /**
   * Выполнить health check
   */
  async performHealthCheck() {
    const startTime = Date.now();

    try {
      const isConnected = this.connectionManager.isConnected();
      const connectionInfo = this.connectionManager.getConnectionInfo();
      const metricsData = this.metrics.getMetrics();

      // Определяем общий статус
      let status = 'healthy';
      const issues = [];

      if (!isConnected) {
        status = 'unhealthy';
        issues.push('Not connected to RabbitMQ');
      }

      // Проверяем высокий процент ошибок
      if (metricsData.consume.errorRate > 0.5) {
        status = 'degraded';
        issues.push(`High error rate: ${(metricsData.consume.errorRate * 100).toFixed(2)}%`);
      }

      // Проверяем попытки переподключения
      if (connectionInfo.reconnectAttempts > 0) {
        status = status === 'healthy' ? 'degraded' : status;
        issues.push(`Reconnect attempts: ${connectionInfo.reconnectAttempts}`);
      }

      // Формат ответа совместимый с тестами
      const health = {
        status,
        timestamp: new Date().toISOString(),
        checks: {
          connection: {
            status: isConnected ? 'healthy' : 'unhealthy',
            message: isConnected ? 'Connected' : 'Not connected',
            url: connectionInfo.url,
            reconnectAttempts: connectionInfo.reconnectAttempts,
            connectedAt: connectionInfo.connectedAt,
          },
          consumers: {
            status: 'healthy',
            // Добавим consumers когда нужно
          },
          metrics: {
            connection: {
              totalConnections: metricsData.connection.totalConnections,
              totalReconnects: metricsData.connection.totalReconnects,
              connectionErrors: metricsData.connection.connectionErrors,
            },
            publish: {
              totalPublished: metricsData.publish.totalPublished,
              publishErrors: metricsData.publish.publishErrors,
            },
            consume: {
              totalConsumed: metricsData.consume.totalConsumed,
              consumeErrors: metricsData.consume.consumeErrors,
              averageProcessingTime: metricsData.consume.averageProcessingTime,
              errorRate: metricsData.consume.errorRate,
            },
          },
        },
        uptime: metricsData.connection.uptime,
        checkDuration: Date.now() - startTime,
        issues: issues.length > 0 ? issues : undefined,
      };

      this.healthStatus = {
        status,
        lastCheck: health.timestamp,
        details: health,
      };

      this.logger.debug({ status, health }, 'Health check completed');

      return health;
    } catch (error) {
      this.logger.error({ err: error }, 'Health check failed');

      const health = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {},
        error: error.message,
        checkDuration: Date.now() - startTime,
      };

      this.healthStatus = {
        status: 'unhealthy',
        lastCheck: health.timestamp,
        details: health,
      };

      return health;
    }
  }

  /**
   * Получить текущий статус здоровья
   */
  getHealthStatus() {
    return this.healthStatus;
  }

  /**
   * Проверить, здорово ли приложение
   */
  isHealthy() {
    return this.healthStatus.status === 'healthy';
  }

  /**
   * Сбросить статус здоровья
   */
  resetHealthStatus() {
    this.healthStatus = {
      status: 'unknown',
      lastCheck: null,
      details: {},
    };
  }
}

module.exports = HealthCheckManager;
