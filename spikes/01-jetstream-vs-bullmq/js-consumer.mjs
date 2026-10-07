import { AckPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { DURABLE, log, resizeAndUpload, sleep, STREAM } from './common.mjs';

// Experiment knobs
const ACK_WAIT_MS = Number(process.env.ACK_WAIT_MS ?? 30_000);
const MAX_DELIVER = Number(process.env.MAX_DELIVER ?? 3);
const NO_ACK = process.env.NO_ACK === '1'; // process but never ack
const SLOW_MS = Number(process.env.SLOW_MS ?? 0); // extra delay before ack
const NAK = process.env.NAK === '1'; // explicit nak instead of ack
const NAK_DELAY_MS = Number(process.env.NAK_DELAY_MS ?? 0);
const TERM = process.env.TERM_MSG === '1'; // msg.term() => never redelivered
const HEARTBEAT = process.env.HEARTBEAT === '1'; // msg.working() during SLOW_MS
const NAME = process.env.NAME ?? `c-${process.pid}`;

const nc = await connect({ servers: process.env.NATS_URL ?? 'localhost:4222' });
const jsm = await jetstreamManager(nc);

const desired = {
  durable_name: DURABLE,
  ack_policy: AckPolicy.Explicit,
  ack_wait: ACK_WAIT_MS * 1_000_000,
  max_deliver: MAX_DELIVER,
  max_ack_pending: 10,
};
try {
  await jsm.consumers.info(STREAM, DURABLE);
  await jsm.consumers.update(STREAM, DURABLE, {
    ack_wait: desired.ack_wait,
    max_deliver: desired.max_deliver,
    max_ack_pending: desired.max_ack_pending,
  });
} catch {
  await jsm.consumers.add(STREAM, desired);
}
log(NAME, `pull consumer ready: ack_wait=${ACK_WAIT_MS}ms max_deliver=${MAX_DELIVER}`);

const js = jetstream(nc);
const consumer = await js.consumers.get(STREAM, DURABLE);
const messages = await consumer.consume({ max_messages: 1 });

process.on('SIGTERM', async () => {
  log(NAME, 'SIGTERM: stop pulling, drain');
  await messages.close();
  await nc.drain();
  process.exit(0);
});

for await (const msg of messages) {
  const { jobId, imageUrl, preset } = msg.json();
  const attempt = msg.info.deliveryCount;
  log(
    NAME,
    `got job=${jobId} seq=${msg.seq} attempt=${attempt}/${MAX_DELIVER} redelivered=${msg.redelivered}`,
  );

  if (TERM) {
    msg.term('permanent failure (spike)');
    log(NAME, `TERM job=${jobId}`);
    continue;
  }
  if (NAK) {
    msg.nak(NAK_DELAY_MS || undefined);
    log(NAME, `NAK job=${jobId} delay=${NAK_DELAY_MS}ms`);
    continue;
  }

  try {
    const key = await resizeAndUpload(jobId, imageUrl, preset);
    log(NAME, `resized -> ${key}`);
    if (SLOW_MS) {
      const step = 1000;
      for (let t = 0; t < SLOW_MS; t += step) {
        await sleep(step);
        if (HEARTBEAT) msg.working();
      }
    }
    if (NO_ACK) {
      log(NAME, `NO ACK job=${jobId} (simulating lost ack)`);
      continue;
    }
    const ok = await msg.ackAck();
    log(NAME, `ACK job=${jobId} confirmed=${ok}`);
  } catch (err) {
    log(NAME, `error job=${jobId}: ${err.message}`);
    msg.nak(1000);
  }
}
