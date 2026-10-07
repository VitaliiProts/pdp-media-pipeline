import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { DURABLE, STREAM } from './common.mjs';

const nc = await connect({ servers: process.env.NATS_URL ?? 'localhost:4222' });
const jsm = await jetstreamManager(nc);

if (process.argv[2] === 'reset') {
  await jsm.streams.delete(STREAM).catch(() => {});
  console.log(`stream ${STREAM} deleted`);
} else {
  const s = await jsm.streams.info(STREAM);
  const c = await jsm.consumers.info(STREAM, DURABLE).catch(() => null);
  console.log({
    stream_messages: s.state.messages,
    first_seq: s.state.first_seq,
    last_seq: s.state.last_seq,
    consumer: c && {
      num_pending: c.num_pending,
      num_ack_pending: c.num_ack_pending,
      num_redelivered: c.num_redelivered,
      ack_floor: c.ack_floor.stream_seq,
      delivered: c.delivered.stream_seq,
    },
  });
}
await nc.close();
