const RabbitMQClient = require('../lib/RabbitMQClient');

async function main() {
  const client = new RabbitMQClient('amqp://localhost', {
    dlq: {
      enabled: true,
      exchange: 'dlx',
      queuePrefix: 'dlq'
    },
    consumeRetry: {
      enabled: true,
      maxAttempts: 3
    }
  });

  try {
    await client.connect();
    console.log('Connected');

    // Create queue with DLQ
    await client.assertQueue('example_queue', { durable: true, dlq: true });
    console.log('Queue created with DLQ');

    // Create DLQ
    await client.assertDlq('example_queue');
    console.log('DLQ created:', client.getDlqName('example_queue'));

    // Consume with retry
    await client.consume('example_queue', async (msg) => {
      const content = JSON.parse(msg.content.toString());
      console.log('Processing:', content);
      
      // Simulate error
      if (content.shouldFail) {
        throw new Error('Processing failed');
      }
    });

    // Publish message that will fail
    await client.publish('example_queue', { shouldFail: true, data: 'test' });
    console.log('Published message that will fail');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check DLQ
    const dlqInfo = await client.getDlqInfo('example_queue');
    console.log('DLQ info:', dlqInfo);

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

