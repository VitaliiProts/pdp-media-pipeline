import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { log } from './common.mjs';

const connection = { host: 'localhost', port: 6380 };
const queue = new Queue('spike-resize', { connection });

const count = Number(process.env.COUNT ?? 1);
for (let i = 0; i < count; i++) {
  const jobId = process.env.JOB_ID ?? randomUUID();
  const job = await queue.add(
    'resize',
    { jobId, imageUrl: 's3://spike/sources/test.jpg', preset: process.env.PRESET ?? 'medium' },
    {
      jobId, // BullMQ dedup: same jobId => add() is a no-op while the job exists
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: false,
      removeOnFail: false,
    },
  );
  log('bull-producer', `added job=${job.id}`);
}
await queue.close();
