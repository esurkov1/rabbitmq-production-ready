/**
 * RetryManager - Универсальная логика retry с exponential backoff
 */
class RetryManager {
  /**
   * Вычислить задержку для retry с exponential backoff
   */
  static calculateDelay(attempt, initialDelay, maxDelay, multiplier) {
    const delay = Math.min(initialDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    return delay;
  }

  /**
   * Выполнить операцию с retry
   * @param {Function} operation - Асинхронная функция для выполнения
   * @param {Object} retryConfig - Конфигурация retry
   * @param {Object} callbacks - Колбэки для логирования и метрик
   * @returns {Promise<any>} Результат операции
   */
  static async executeWithRetry(operation, retryConfig, callbacks = {}) {
    const { onRetry, onSuccess, onFailure } = callbacks;
    let lastError;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        if (attempt > 1 && onSuccess) {
          onSuccess(attempt);
        }

        return result;
      } catch (error) {
        lastError = error;

        if (attempt < retryConfig.maxAttempts) {
          const delay = this.calculateDelay(
            attempt,
            retryConfig.initialDelay,
            retryConfig.maxDelay,
            retryConfig.multiplier
          );

          if (onRetry) {
            onRetry(error, attempt, delay);
          }

          await this.sleep(delay);
        }
      }
    }

    if (onFailure) {
      onFailure(lastError, retryConfig.maxAttempts);
    }

    throw lastError;
  }

  /**
   * Sleep helper
   */
  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Получить retry count из заголовков сообщения
   */
  static getRetryCount(msg) {
    const headers = msg?.properties?.headers || {};
    return headers['x-retry-count'] || 0;
  }

  /**
   * Увеличить retry count в заголовках
   */
  static incrementRetryCount(msg) {
    const headers = msg.properties?.headers || {};
    headers['x-retry-count'] = (headers['x-retry-count'] || 0) + 1;
    return headers;
  }
}

module.exports = RetryManager;

