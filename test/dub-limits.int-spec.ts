import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { seedUser } from '../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from './support/apps';
import { prepareDatabase, registerUpload } from './support/helpers';
import { BUCKET, type Infra, startInfra } from './support/infra';

type User = { userId: string; apiKey: string };

/**
 * No scheduler: created dubs stay queued and hold their reservation. 150 s per user and 200 s
 * for everyone: one user never reaches the system-wide limit alone.
 */
describe('dub limits and quota', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let apiKey: string;
  let userId: string;
  let other: User;
  let gateway: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    ({ apiKey, userId } = db.user);
    other = await seedUser(infra.databaseUrl, 'int-test-other');
    apps = createApps(infra);
    await apps.start('metadata', { DUB_QUOTA_SECONDS: '150', DUB_SYSTEM_QUOTA_SECONDS: '200' });
    gateway = await apps.start('api-gateway');
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  beforeEach(() => pool.query(`DELETE FROM jobs WHERE type = 'video.dub'`));

  /** An upload in the library; `durationSeconds` as a finished frames job would have recorded. */
  async function video(durationSeconds: number | null, owner = userId): Promise<string> {
    const key = `uploads/${owner}/${randomUUID()}.mp4`;
    await infra.s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'mp4', ContentType: 'video/mp4' }),
    );
    const assetId = await registerUpload(pool, key, 3);
    await pool.query('UPDATE assets SET duration_seconds = $1 WHERE id = $2', [
      durationSeconds,
      assetId,
    ]);
    return key;
  }

  async function dub(body: Record<string, unknown>, key = apiKey) {
    const res = await fetch(`${gateway}/v1/jobs`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'video.dub', targetLanguage: 'uk', ...body }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('creates a dub of a library video and rejects what the input does not allow', async () => {
    const sourceKey = await video(12);
    expect((await dub({ sourceKey })).status).toBe(202);

    const noLanguage = await dub({ sourceKey, targetLanguage: undefined });
    expect(noLanguage.status).toBe(400);
    const byUrl = await dub({ sourceUrl: 'https://example.com/a.mp4' });
    expect(byUrl).toMatchObject({ status: 400 });
    expect(String(byUrl.body.message)).toContain('sourceKey');
    const sameLanguage = await dub({ sourceKey, sourceLanguage: 'uk' });
    expect(sameLanguage.status).toBe(400);
  });

  it('rejects a video known to be longer than a dub may be', async () => {
    const res = await dub({ sourceKey: await video(75) });
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(String(res.body.message)).toContain('75 s');
  });

  it('counts known durations, reserves a minute for unknown ones and frees failed dubs', async () => {
    expect((await dub({ sourceKey: await video(50) })).status).toBe(202);
    const unknown = await dub({ sourceKey: await video(null) });
    expect(unknown.status).toBe(202);

    // 50 + 60 reserved + 50 > 150.
    const over = await dub({ sourceKey: await video(50) });
    expect(over).toMatchObject({ status: 429, body: { code: 'DUB_QUOTA_EXCEEDED' } });
    expect(String(over.body.message)).toContain('110 of 150 s');

    await pool.query(`UPDATE jobs SET status = 'failed' WHERE id = $1`, [unknown.body.jobId]);
    expect((await dub({ sourceKey: await video(50) })).status).toBe(202);
  });

  it('counts a succeeded dub by its duration and forgets last month', async () => {
    const first = await dub({ sourceKey: await video(null) });
    await pool.query(
      `UPDATE jobs SET status = 'succeeded', output = '{"durationSeconds": 20.4}' WHERE id = $1`,
      [first.body.jobId],
    );
    const second = await dub({ sourceKey: await video(60) });
    expect(second.status).toBe(202);
    expect((await dub({ sourceKey: await video(60) })).status).toBe(202);
    // ceil(20.4 + 60 + 60) + 60 > 150.
    const over = await dub({ sourceKey: await video(60) });
    expect(String(over.body.message)).toContain('141 of 150 s');

    await pool.query(
      `UPDATE jobs SET created_at = date_trunc('month', now(), 'UTC') - interval '1 second'
       WHERE id = $1`,
      [second.body.jobId],
    );
    expect((await dub({ sourceKey: await video(60) })).status).toBe(202);
  });

  async function quota(key = apiKey) {
    const res = await fetch(`${gateway}/v1/dub-quota`, { headers: { 'x-api-key': key } });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  it('reports what the quota check counts, for the form to warn before a dub', async () => {
    const now = new Date();
    const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    expect(await quota()).toEqual({
      usedSeconds: 0,
      limitSeconds: 150,
      remainingSeconds: 150,
      systemLimited: false,
      maxVideoSeconds: 60,
      resetsAt: resetsAt.toISOString(),
    });

    await dub({ sourceKey: await video(50) });
    await dub({ sourceKey: await video(null) });
    expect(await quota()).toMatchObject({ usedSeconds: 110, remainingSeconds: 40 });

    const unauthenticated = await fetch(`${gateway}/v1/dub-quota`);
    expect(unauthenticated.status).toBe(401);
  });

  it('stops every user at the system-wide limit, and the quota says which limit binds', async () => {
    expect((await dub({ sourceKey: await video(60) })).status).toBe(202);
    expect((await dub({ sourceKey: await video(60) })).status).toBe(202);
    expect((await dub({ sourceKey: await video(50, other.userId) }, other.apiKey)).status).toBe(
      202,
    );

    // 170 of 200 used: the other user has 100 s of their own, but the service only 30.
    expect(await quota(other.apiKey)).toMatchObject({
      usedSeconds: 50,
      remainingSeconds: 30,
      systemLimited: true,
    });
    const over = await dub({ sourceKey: await video(40, other.userId) }, other.apiKey);
    expect(over).toMatchObject({ status: 429, body: { code: 'DUB_SYSTEM_QUOTA_EXCEEDED' } });
    expect(String(over.body.message)).toContain('170 of 200 s');
    expect((await dub({ sourceKey: await video(30, other.userId) }, other.apiKey)).status).toBe(
      202,
    );
  });

  it('lets only one of two users take the last system-wide seconds at the same time', async () => {
    await dub({ sourceKey: await video(60) });
    await dub({ sourceKey: await video(60, other.userId) }, other.apiKey);
    // 120 of 200: room for one more 60 s dub, not two; each user has 90 s of their own.
    const [mineKey, theirsKey] = [await video(60), await video(60, other.userId)];

    // Holding the system-wide lock lines both up behind it, the way two dubs that arrive
    // together meet; without the lock both would read 120 s and pass.
    const holder = await pool.connect();
    let settled = 0;
    let both: Promise<Awaited<ReturnType<typeof dub>>[]>;
    try {
      await holder.query('begin');
      await holder.query(`select pg_advisory_xact_lock(hashtextextended('dub-system-quota', 0))`);
      both = Promise.all(
        [dub({ sourceKey: mineKey }), dub({ sourceKey: theirsKey }, other.apiKey)].map((p) =>
          p.finally(() => settled++),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(0);
    } finally {
      await holder.query('rollback');
      holder.release();
    }

    const results = await both;
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(results.find((r) => r.status === 429)?.body.code).toBe('DUB_SYSTEM_QUOTA_EXCEEDED');
  });
});
