import { EventEmitter } from 'events';
import { Connection, Channel, ConsumeMessage, Options } from 'amqplib';
import { Logger } from 'pino';

export interface Hooks {
  onPublish?: (data: { queue: string; exchange: string; routingKey?: string; messageSize: number; duration: number; correlationId: string }) => void;
  onConsume?: (data: { queue: string; processingTime: number; correlationId: string; retryCount: number }) => void;
  onError?: (data: { type: 'publish' | 'consume'; error: Error; queue?: string; exchange?: string; routingKey?: string; correlationId?: string; retryCount?: number }) => void;
  onConnectionChange?: (data: { connected: boolean; wasReconnect?: boolean }) => void;
}

export interface RabbitMQClientOptions {
  logger?: Logger;
  logLevel?: string;
  hooks?: Hooks;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
  reconnectMultiplier?: number;
  shutdownTimeout?: number;
  registerShutdownHandlers?: boolean;
  correlationIdGenerator?: () => string;
  publishRetry?: RetryConfig;
  consumeRetry?: RetryConfig;
  dlq?: DLQConfig;
}

export interface RetryConfig {
  enabled?: boolean;
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  multiplier?: number;
}

export interface DLQConfig {
  enabled?: boolean;
  exchange?: string;
  queuePrefix?: string;
  ttl?: number | null;
}

export interface PublishOptions extends Options.Publish {
  retry?: boolean;
  correlationId?: string;
}

export interface ConsumeOptions extends Options.Consume {
  prefetch?: number;
  maxRetries?: number;
  retry?: boolean;
  requeue?: boolean;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  checks: {
    connection: {
      status: string;
      message: string;
    };
    consumers: {
      status: string;
      count: number;
      queues: string[];
    };
  };
}

export interface Metrics {
  connection: {
    totalConnections: number;
    totalReconnects: number;
    connectionErrors: number;
    lastConnectionTime: number | null;
    lastDisconnectionTime: number | null;
  };
  publish: {
    totalPublished: number;
    publishedByQueue: Record<string, number>;
    publishedByExchange: Record<string, number>;
    publishErrors: number;
    publishRetries: number;
    totalBytesPublished: number;
  };
  consume: {
    totalConsumed: number;
    consumedByQueue: Record<string, number>;
    consumeErrors: number;
    consumeRetries: number;
    requeued: number;
    sentToDlq: number;
    totalProcessingTime: number;
    minProcessingTime: number | null;
    maxProcessingTime: number | null;
  };
  queue: {
    totalAsserted: number;
    totalDeleted: number;
    totalPurged: number;
  };
  exchange: {
    totalAsserted: number;
    totalDeleted: number;
    totalBindings: number;
  };
}

declare class RabbitMQClient extends EventEmitter {
  constructor(connectionString: string, options?: RabbitMQClientOptions);

  connect(): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;

  publish(queue: string, message: string | Buffer | object, options?: PublishOptions): Promise<boolean>;
  publishToExchange(exchange: string, routingKey: string, message: string | Buffer | object, options?: PublishOptions): Promise<boolean>;

  consume(queue: string, handler: (msg: ConsumeMessage) => Promise<void>, options?: ConsumeOptions): Promise<string>;
  stopConsuming(queue: string): Promise<void>;

  assertQueue(queue: string, options?: Options.AssertQueue): Promise<Options.AssertQueue>;
  deleteQueue(queue: string, options?: Options.DeleteQueue): Promise<Options.DeleteQueue>;
  purgeQueue(queue: string): Promise<Options.PurgeQueue>;
  getQueueInfo(queue: string): Promise<Options.AssertQueue>;

  assertExchange(exchange: string, type: string, options?: Options.AssertExchange): Promise<Options.AssertExchange>;
  deleteExchange(exchange: string, options?: Options.DeleteExchange): Promise<void>;
  bindQueue(queue: string, exchange: string, routingKey: string, args?: object): Promise<Options.Empty>;
  unbindQueue(queue: string, exchange: string, routingKey: string, args?: object): Promise<void>;
  getExchangeInfo(exchange: string): Promise<Options.Empty>;

  getDlqName(queue: string): string;
  assertDlq(queue: string): Promise<Options.AssertQueue>;
  getDlqInfo(queue: string): Promise<Options.AssertQueue>;
  purgeDlq(queue: string): Promise<Options.PurgeQueue>;
  deleteDlq(queue: string, options?: Options.DeleteQueue): Promise<Options.DeleteQueue>;

  healthCheck(): Promise<HealthCheckResult>;
  getMetrics(): Metrics;
  resetMetrics(): void;
  waitForConnection(timeout?: number, interval?: number): Promise<void>;
  getConnectionInfo(): {
    connected: boolean;
    connectionString: string;
    reconnectAttempts: number;
    autoReconnect: boolean;
    maxReconnectAttempts: number;
    lastConnectionTime: number | null;
    lastDisconnectionTime: number | null;
    totalConnections: number;
    totalReconnects: number;
    connectionErrors: number;
  };
  getAllConsumers(): Array<{ queue: string; consumerTag: string }>;
}

export = RabbitMQClient;
export as namespace RabbitMQClient;

