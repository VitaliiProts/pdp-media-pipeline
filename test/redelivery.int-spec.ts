import { AckPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { MetadataClient } from '@pdp/metadata-client';
import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, putSource, waitFor } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

const ACK_WAIT_MS = 2000;
const WORKER_CONCURRENCY = 2;

describe('redelivery after a lost ack', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let nc: NatsConnection;
  let client: MetadataClient;
  let userId: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    userId = db.user.userId;
    apps = createApps(infra);
    client = new MetadataClient({ baseUrl: await apps.start('metadata'), timeoutMs: 5000 });
    await apps.start('scheduler');
    nc = await connect({ servers: infra.natsUrl });
  });

  afterAll(async () => {
    await nc?.close();
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  it('runs a second attempt after AckWait and records both executions', async () => {
    // Same settings the worker declares, so its ensurePullConsumer is a no-op update.
    await jetstreamManager(nc).then((jsm) =>
      jsm.consumers.add('JOBS_CPU', {
        durable_name: 'worker-cpu',
        filter_subject: 'jobs.cpu.image.resize',
        ack_policy: AckPolicy.Explicit,
        ack_wait: ACK_WAIT_MS * 1_000_000,
        max_deliver: -1,
        max_ack_pending: 2 * WORKER_CONCURRENCY,
      }),
    );

    const sourceKey = `uploads/${userId}/redelivery.png`;
    await putSource(infra.s3, sourceKey, await pngImage(400, 300));
    const { job } = await client.createJob({
      userId,
      type: 'image.resize',
      input: { sourceKey, presets: ['thumb'] },
    });

    // A worker takes the message, reports running and dies without acking.
    const consumer = await jetstream(nc).consumers.get('JOBS_CPU', 'worker-cpu');
    const msg = await waitFor(() => consumer.next({ expires: 1000 }), { what: 'dispatch' });
    expect(msg.info.deliveryCount).toBe(1);
    await client.transition(job.id, { to: 'running', attempt: 1, actor: 'worker:crashed' });

    await apps.start('worker', {
      WORKER_ACK_WAIT_MS: String(ACK_WAIT_MS),
      WORKER_CONCURRENCY: String(WORKER_CONCURRENCY),
    });

    const finished = await waitFor(
      async () => {
        const current = await client.getJob(job.id);
        return current.status === 'succeeded' ? current : undefined;
      },
      { what: 'second attempt to succeed', timeoutMs: 20_000 },
    );
    expect(finished.attempts).toBe(2);

    const { rows } = await pool.query<{ attempt: number; outcome: string; worker_id: string }>(
      'select attempt, outcome, worker_id from job_executions where job_id = $1 order by attempt',
      [job.id],
    );
    expect(rows).toEqual([
      { attempt: 1, outcome: 'abandoned', worker_id: 'worker:crashed' },
      { attempt: 2, outcome: 'succeeded', worker_id: expect.stringMatching(/^worker:/) as string },
    ]);
  });
});
