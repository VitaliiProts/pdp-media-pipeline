import { connect } from '@nats-io/transport-node';
import { log } from './common.mjs';

// JetStream emits advisories when a message exhausts MaxDeliver or is terminated.
// This is the hook for a DLQ: nothing is moved automatically.
const nc = await connect({ servers: process.env.NATS_URL ?? 'localhost:4222' });
const sub = nc.subscribe('$JS.EVENT.ADVISORY.CONSUMER.>');
log('advisory', 'listening on $JS.EVENT.ADVISORY.CONSUMER.>');
for await (const m of sub) {
  const data = m.json();
  log(
    'advisory',
    m.subject.split('.').slice(4, 5)[0],
    JSON.stringify({
      stream: data.stream,
      consumer: data.consumer,
      stream_seq: data.stream_seq,
      deliveries: data.deliveries,
      reason: data.reason,
    }),
  );
}
