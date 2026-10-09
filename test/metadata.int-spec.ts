import { JobCreatedV1 } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { prepareDatabase, readStream, waitFor } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

describe('metadata (Postgres + NATS)', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let client: MetadataClient;
  let userId: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    userId = db.user.userId;
    apps = createApps(infra);
    client = new MetadataClient({ baseUrl: await apps.start('metadata'), timeoutMs: 5000 });
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  const createJob = () =>
    client.createJob({
      userId,
      type: 'image.resize',
      input: { sourceKey: `uploads/${userId}/a.png`, presets: ['thumb'] },
    });

  it('applies a transition exactly once under concurrent identical calls', async () => {
    const job = await createJob();

    const scheduled = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.transition(job.id, {
          to: 'scheduled',
          attempt: 0,
          actor: 'scheduler',
          class: 'cpu',
        }),
      ),
    );
    expect(scheduled.filter((r) => r.applied)).toHaveLength(1);

    const running = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        client.transition(job.id, { to: 'running', attempt: 1, actor: `worker:${i}` }),
      ),
    );
    expect(running.filter((r) => r.applied)).toHaveLength(1);

    const { rows: transitions } = await pool.query<{ to_status: string }>(
      'select to_status from job_transitions where job_id = $1 order by created_at',
      [job.id],
    );
    expect(transitions.map((t) => t.to_status)).toEqual(['scheduled', 'running']);

    const { rows: executions } = await pool.query(
      'select attempt from job_executions where job_id = $1',
      [job.id],
    );
    expect(executions).toEqual([{ attempt: 1 }]);
  });

  it('lets only one of two racing attempts finish the job', async () => {
    const job = await createJob();
    await client.transition(job.id, { to: 'running', attempt: 1, actor: 'worker:a' });
    await client.transition(job.id, { to: 'running', attempt: 2, actor: 'worker:b' });

    const outcomes = await Promise.allSettled([
      client.transition(job.id, { to: 'succeeded', attempt: 1, actor: 'worker:a', output: {} }),
      client.transition(job.id, { to: 'succeeded', attempt: 2, actor: 'worker:b', output: {} }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    await expect(client.getJob(job.id)).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('publishes job.created to EVENTS exactly once, even when the relay republishes', async () => {
    const job = await createJob();
    const published = () =>
      pool
        .query<{ published_at: Date | null }>(
          `select published_at from outbox where payload->'payload'->>'jobId' = $1 and subject = $2`,
          [job.id, JobCreatedV1.subject],
        )
        .then((r) => r.rows[0]?.published_at);

    await waitFor(published, { what: 'outbox publish' });
    // Simulates a crash between publish and commit: the relay sends the same event again.
    await pool.query(
      `update outbox set published_at = null where payload->'payload'->>'jobId' = $1`,
      [job.id],
    );
    await waitFor(published, { what: 'outbox republish' });

    const events = (await readStream(infra.natsUrl, 'EVENTS', JobCreatedV1.subject)).map((e) =>
      JobCreatedV1.parse(e),
    );
    expect(events.filter((e) => e.payload.jobId === job.id)).toHaveLength(1);
  });
});
