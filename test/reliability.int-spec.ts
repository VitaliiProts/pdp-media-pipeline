import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { AckPolicy, type Consumer, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  deadLetterSubject,
  dispatchMessageId,
  imageResultKey,
  JobDeadLetteredV1,
  JobDispatchV1,
  type JobDto,
} from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { startTestMetrics, type TestMetrics } from '@pdp/observability/testing';
import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, putSource, readStream, waitFor } from './support/helpers';
import { BUCKET, type Infra, startInfra } from './support/infra';
import { startTcpProxy, type TcpProxy } from './support/tcp-proxy';

const MAX_ATTEMPTS = 3;
const ACK_WAIT_MS = 1000;
const CONSUMER = 'worker-cpu';

describe('retries, dead letters and duplicate deliveries', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let nc: NatsConnection;
  let consumer: Consumer;
  let client: MetadataClient;
  let s3Proxy: TcpProxy;
  let userId: string;
  let telemetry: TestMetrics;

  beforeAll(async () => {
    telemetry = startTestMetrics();
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    userId = db.user.userId;
    apps = createApps(infra);
    client = new MetadataClient({
      baseUrl: await apps.start('metadata', { JOB_MAX_ATTEMPTS: String(MAX_ATTEMPTS) }),
      timeoutMs: 5000,
    });
    await apps.start('scheduler');
    s3Proxy = await startTcpProxy(infra.s3Endpoint);

    // The tests play a crashing worker on the real durable until the real one starts.
    nc = await connect({ servers: infra.natsUrl });
    await jetstreamManager(nc).then((jsm) =>
      jsm.consumers.add('JOBS_CPU', {
        durable_name: CONSUMER,
        filter_subject: 'jobs.cpu.image.resize',
        ack_policy: AckPolicy.Explicit,
        ack_wait: ACK_WAIT_MS * 1_000_000,
        max_deliver: -1,
        max_ack_pending: 4,
      }),
    );
    consumer = await jetstream(nc).consumers.get('JOBS_CPU', CONSUMER);
  });

  afterAll(async () => {
    await nc?.close();
    await apps?.stopAll();
    await s3Proxy?.close();
    await pool?.end();
    await infra?.stop();
    await telemetry?.stop();
  });

  const createJob = async (name: string) => {
    const sourceKey = `uploads/${userId}/${name}.png`;
    await putSource(infra.s3, pool, sourceKey, await pngImage(400, 300));
    const { job } = await client.createJob({
      userId,
      type: 'image.resize',
      input: { sourceKey, presets: ['thumb'] },
    });
    return job;
  };

  const nextDispatch = async () => {
    const msg = await waitFor(() => consumer.next({ expires: 1000 }), { what: 'dispatch' });
    return { msg, dispatch: JobDispatchV1.parse(msg.json()) };
  };

  const untilStatus = (id: string, status: JobDto['status'], timeoutMs = 20_000) =>
    waitFor(
      async () => {
        const job = await client.getJob(id);
        return job.status === status ? job : undefined;
      },
      { what: `job ${id} to be ${status}`, timeoutMs },
    );

  const executions = (jobId: string) =>
    pool
      .query<{ attempt: number; outcome: string | null }>(
        'select attempt, outcome from job_executions where job_id = $1 order by attempt',
        [jobId],
      )
      .then((r) => r.rows);

  const deadLetters = async (jobId: string) =>
    (await readStream(infra.natsUrl, 'JOBS_DLQ', deadLetterSubject('image.resize')))
      .map((e) => JobDeadLetteredV1.parse(e))
      .filter((e) => e.payload.jobId === jobId);

  const metric = (name: string, attributes: Record<string, string>) =>
    telemetry.value(name, attributes);

  it('ends a crash loop as dead / exhausted and dead-letters it once', async () => {
    const job = await createJob('crash-loop');

    for (;;) {
      const { msg, dispatch } = await nextDispatch();
      expect(dispatch.jobId).toBe(job.id);
      const started = await client.transition(job.id, {
        to: 'running',
        attempt: msg.info.deliveryCount,
        actor: 'worker:crashing',
        inbox: { consumer: CONSUMER, messageId: dispatchMessageId(job.id, 0) },
      });
      if (started.job.status === 'dead') {
        expect(msg.info.deliveryCount).toBe(MAX_ATTEMPTS + 1);
        msg.ack();
        break;
      }
      // Crashes without acking; NATS redelivers after AckWait.
    }

    const dead = await client.getJob(job.id);
    expect(dead).toMatchObject({ status: 'dead', deadReason: 'exhausted', attempts: MAX_ATTEMPTS });
    expect(await executions(job.id)).toEqual(
      [1, 2, 3].map((attempt) => ({ attempt, outcome: 'abandoned' })),
    );
    const letters = await waitFor(
      async () => {
        const found = await deadLetters(job.id);
        return found.length > 0 && found;
      },
      { what: 'dead letter' },
    );
    expect(letters).toHaveLength(1);
    expect(letters[0]?.payload).toMatchObject({ reason: 'exhausted', attempts: MAX_ATTEMPTS });
  });

  it('skips a redelivery of a message that already finished the job (lost ack)', async () => {
    const job = await createJob('lost-ack');
    const inbox = { consumer: CONSUMER, messageId: dispatchMessageId(job.id, 0) };

    // A worker finishes the job, and its ack never reaches NATS.
    const { msg } = await nextDispatch();
    await client.transition(job.id, { to: 'running', attempt: 1, actor: 'worker:a', inbox });
    await client.transition(job.id, {
      to: 'succeeded',
      attempt: 1,
      actor: 'worker:a',
      output: { results: [] },
      inbox,
    });
    expect(msg.info.deliveryCount).toBe(1);
    const duplicatesBefore = await metric('jobs.duplicates', { source: 'inbox' });

    await apps.start('worker', {
      S3_ENDPOINT: s3Proxy.url,
      WORKER_ACK_WAIT_MS: '2000',
      WORKER_RETRY_BASE_MS: '100',
      WORKER_RETRY_MAX_MS: '300',
    });

    await waitFor(
      async () => (await metric('jobs.duplicates', { source: 'inbox' })) > duplicatesBefore,
      { what: 'inbox to catch the redelivery' },
    );
    await waitFor(
      async () => {
        const info = await consumer.info();
        return info.num_pending === 0 && info.num_ack_pending === 0;
      },
      { what: 'redelivery to be acked' },
    );
    expect(await executions(job.id)).toEqual([{ attempt: 1, outcome: 'succeeded' }]);
    // The real worker never processed it, so it wrote no result.
    await expect(
      infra.s3.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: imageResultKey(job.id, 'thumb') }),
      ),
    ).rejects.toThrow();
  });

  it('retries a transient storage outage until exhausted, then succeeds after a redrive', async () => {
    const type = { type: 'image.resize' };
    const exhausted = { ...type, outcome: 'exhausted' };
    const succeeded = { ...type, outcome: 'succeeded' };
    const before = {
      retries: await metric('jobs.retries', type),
      dlq: await metric('jobs.dlq', { ...type, reason: 'exhausted' }),
      exhausted: await metric('jobs.finished', exhausted),
      exhaustedE2e: await metric('job.e2e.duration', exhausted),
    };
    s3Proxy.mode = 'reset';
    const job = await createJob('storage-outage');

    const dead = await untilStatus(job.id, 'dead');
    expect(dead).toMatchObject({ deadReason: 'exhausted', attempts: MAX_ATTEMPTS });
    expect(dead.lastError).toBeTruthy();
    expect(await executions(job.id)).toEqual([
      { attempt: 1, outcome: 'retry' },
      { attempt: 2, outcome: 'retry' },
      { attempt: 3, outcome: 'failed' },
    ]);
    expect(await metric('jobs.retries', type)).toBe(before.retries + MAX_ATTEMPTS - 1);
    expect(await metric('jobs.dlq', { ...type, reason: 'exhausted' })).toBe(before.dlq + 1);
    expect(await metric('jobs.finished', exhausted)).toBe(before.exhausted + 1);
    expect(await metric('job.e2e.duration', exhausted)).toBe(before.exhaustedE2e + 1);
    await waitFor(async () => (await deadLetters(job.id)).length === 1, { what: 'dead letter' });

    const succeededBefore = await metric('jobs.finished', succeeded);
    const succeededE2eBefore = await metric('job.e2e.duration', succeeded);
    s3Proxy.mode = 'forward';
    const redriven = await client.redrive(job.id, { actor: 'test' });
    expect(redriven).toMatchObject({ status: 'queued', attemptBase: MAX_ATTEMPTS + 1 });

    const finished = await untilStatus(job.id, 'succeeded');
    expect(finished).toMatchObject({ attempts: MAX_ATTEMPTS + 2, deadReason: null });
    expect((await executions(job.id)).at(-1)).toEqual({
      attempt: MAX_ATTEMPTS + 2,
      outcome: 'succeeded',
    });
    await expect(
      infra.s3.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: imageResultKey(job.id, 'thumb') }),
      ),
    ).resolves.toBeDefined();
    // A redriven generation counts as finished but stays out of the latency SLI.
    expect(await metric('jobs.finished', succeeded)).toBe(succeededBefore + 1);
    expect(await metric('job.e2e.duration', succeeded)).toBe(succeededE2eBefore);
  });

  it('refuses to redrive a job that is not dead', async () => {
    const job = await createJob('not-dead');
    await untilStatus(job.id, 'succeeded');
    await expect(client.redrive(job.id, { actor: 'test' })).rejects.toMatchObject({
      status: 409,
      code: 'NOT_REDRIVABLE',
    });
  });
});
