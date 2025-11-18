const RabbitMQClient = require('../lib/RabbitMQClient');

// Example Prometheus metrics (using prom-client)
// const { Counter, Histogram, Gauge } = require('prom-client');

// const publishCounter = new Counter({
//   name: 'rabbitmq_published_total',
//   help: 'Total published messages'
// });

// const consumeHistogram = new Histogram({
//   name: 'rabbitmq_processing_duration_seconds',
//   help: 'Message processing duration'
// });

async function main() {
  const client = new RabbitMQClient('amqp://localhost', {
    hooks: {
      onPublish: (data) => {
        // publishCounter.inc({ queue: data.queue, exchange: data.exchange });
        console.log('Publish hook:', data);
      },
      onConsume: (data) => {
        // consumeHistogram.observe(data.processingTime);
        console.log('Consume hook:', data);
      },
      onError: (data) => {
        console.log('Error hook:', data);
      },
      onConnectionChange: (data) => {
        console.log('Connection change hook:', data);
      }
    }
  });

  try {
    await client.connect();
    console.log('Connected');

    await client.assertQueue('example_queue');

    await client.consume('example_queue', async (msg) => {
      const content = JSON.parse(msg.content.toString());
      console.log('Received:', content);
    });

    await client.publish('example_queue', { data: 'test' });

    await new Promise(resolve => setTimeout(resolve, 2000));

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

