const RabbitMQClient = require('../lib/RabbitMQClient');

async function main() {
  const client = new RabbitMQClient('amqp://localhost');

  try {
    // Connect
    await client.connect();
    console.log('Connected to RabbitMQ');

    // Create queue
    await client.assertQueue('example_queue', { durable: true });
    console.log('Queue created');

    // Publish message
    await client.publish('example_queue', { message: 'Hello World', timestamp: Date.now() });
    console.log('Message published');

    // Consume messages
    await client.consume('example_queue', async (msg) => {
      const content = JSON.parse(msg.content.toString());
      console.log('Received:', content);
    });
    console.log('Consumer started');

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Health check
    const health = await client.healthCheck();
    console.log('Health:', health.status);

    // Get metrics
    const metrics = client.getMetrics();
    console.log('Metrics:', {
      published: metrics.publish.totalPublished,
      consumed: metrics.consume.totalConsumed,
    });

    // Close
    await client.close();
    console.log('Closed');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
