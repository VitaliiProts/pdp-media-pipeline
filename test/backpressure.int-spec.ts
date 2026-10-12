import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, putSource, waitFor } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

const MAX_CPU_DEPTH = 3;
const RETRY_AFTER_S = 2;

describe('backpressure at the gateway', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let apiKey: string;
  let gateway: string;
  let sourceKey: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    apiKey = db.user.apiKey;
    sourceKey = `uploads/${db.user.userId}/backpressure.png`;
    await putSource(infra.s3, sourceKey, await pngImage(400, 300));
    apps = createApps(infra);
    await apps.start('metadata');
    // No worker yet: dispatched jobs pile up in the cpu stream.
    await apps.start('scheduler');
    gateway = await apps.start('api-gateway', {
      BACKPRESSURE_MAX_DEPTH_CPU: String(MAX_CPU_DEPTH),
      BACKPRESSURE_RETRY_AFTER_S: String(RETRY_AFTER_S),
      QUEUE_DEPTH_CACHE_MS: '100',
      RATE_LIMIT_USER_RPS: '1000',
      RATE_LIMIT_USER_BURST: '1000',
    });
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  const createJob = (priority?: number) =>
    fetch(`${gateway}/v1/jobs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'image.resize',
        sourceKey,
        presets: ['thumb'],
        ...(priority === undefined ? {} : { priority }),
      }),
    });

  it('sheds new jobs with 503 once the queue is full and admits them again after it drains', async () => {
    let accepted = 0;
    const refused = await waitFor(
      async () => {
        const res = await createJob();
        if (res.status === 202) {
          accepted++;
          return undefined;
        }
        return res;
      },
      { what: 'the gateway to shed load', intervalMs: 200 },
    );

    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe(String(RETRY_AFTER_S));
    await expect(refused.json()).resolves.toMatchObject({
      statusCode: 503,
      retryAfterSeconds: RETRY_AFTER_S,
    });
    expect(accepted).toBeGreaterThanOrEqual(MAX_CPU_DEPTH);

    // Priority jobs have their own stream and are not stuck behind the cpu backlog.
    expect((await createJob(9)).status).toBe(202);

    await apps.start('worker');
    await waitFor(async () => (await createJob()).status === 202, {
      what: 'the gateway to accept jobs again',
      intervalMs: 200,
    });
  });
});
