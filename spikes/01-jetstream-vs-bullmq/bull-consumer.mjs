import { Worker } from 'bullmq';
import { log, resizeAndUpload, sleep } from './common.mjs';

const connection = { host: 'localhost', port: 6380 };
const SLOW_MS = Number(process.env.SLOW_MS ?? 0);
const FAIL = process.env.FAIL === '1';
const NAME = process.env.NAME ?? `bw-${process.pid}`;

const worker = new Worker(
  'spike-resize',
  async (job) => {
    log(
      NAME,
      `got job=${job.id} attemptsMade=${job.attemptsMade} stalledCounter=${job.stalledCounter ?? 0}`,
    );
    if (FAIL) throw new Error('simulated transient failure');
    const key = await resizeAndUpload(job.data.jobId, job.data.imageUrl, job.data.preset);
    if (SLOW_MS) await sleep(SLOW_MS);
    return key;
  },
  {
    connection,
    concurrency: 1,
    lockDuration: Number(process.env.LOCK_MS ?? 30_000),
    stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? 30_000),
    maxStalledCount: Number(process.env.MAX_STALLED ?? 1),
  },
);

worker.on('completed', (job, res) => log(NAME, `completed job=${job.id} -> ${res}`));
worker.on('failed', (job, err) =>
  log(NAME, `failed job=${job?.id} attemptsMade=${job?.attemptsMade}: ${err.message}`),
);
worker.on('stalled', (id) => log(NAME, `stalled job=${id}`));
log(NAME, 'worker started');
