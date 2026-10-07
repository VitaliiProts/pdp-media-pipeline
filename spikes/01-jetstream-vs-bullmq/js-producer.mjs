import { jetstream, jetstreamManager, RetentionPolicy } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { randomUUID } from 'node:crypto';
import { log, STREAM, SUBJECT } from './common.mjs';

const count = Number(process.env.COUNT ?? 1);
const preset = process.env.PRESET ?? 'medium';
const imageUrl = process.env.IMAGE_URL ?? 's3://spike/sources/test.jpg';
const dedupId = process.env.MSG_ID; // fixed id => test JetStream dedup window

const nc = await connect({ servers: process.env.NATS_URL ?? 'localhost:4222' });
const jsm = await jetstreamManager(nc);

try {
  await jsm.streams.info(STREAM);
} catch {
  await jsm.streams.add({
    name: STREAM,
    subjects: [SUBJECT],
    retention: RetentionPolicy.Workqueue,
    duplicate_window: 120 * 1_000_000_000, // ns
  });
  log('producer', `stream ${STREAM} created (WorkQueue retention)`);
}

const js = jetstream(nc);
for (let i = 0; i < count; i++) {
  const jobId = randomUUID();
  const ack = await js.publish(SUBJECT, JSON.stringify({ jobId, imageUrl, preset }), {
    msgID: dedupId ?? jobId,
  });
  log('producer', `published job=${jobId} seq=${ack.seq} duplicate=${ack.duplicate}`);
}

await nc.drain();
