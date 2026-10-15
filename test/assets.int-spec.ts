import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Pool } from 'pg';
import { seedUser } from '../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, waitFor } from './support/helpers';
import { BUCKET, type Infra, startInfra } from './support/infra';

const QUOTA_BYTES = 5_000_000;
const MB3 = 3_000_000;

interface Summary {
  id: string;
  kind: string;
  name: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  sourceKey: string;
  preview: { url: string; width: number; height: number } | null;
  latestJob: { id: string; status: string } | null;
}
interface Details extends Omit<Summary, 'preview' | 'latestJob'> {
  originalUrl: string;
  jobs: { id: string; status: string; results?: { url: string }[] }[];
  jobsNextCursor: string | null;
}

describe('media library', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let gateway: string;

  beforeAll(async () => {
    infra = await startInfra();
    ({ pool } = await prepareDatabase(infra));
    apps = createApps(infra);
    await apps.start('metadata', {
      STORAGE_QUOTA_BYTES: String(QUOTA_BYTES),
      ASSET_JANITOR_INTERVAL_MS: '300',
    });
    await apps.start('scheduler');
    await apps.start('worker');
    gateway = await apps.start('api-gateway', {
      RATE_LIMIT_USER_RPS: '1000',
      RATE_LIMIT_USER_BURST: '1000',
      RATE_LIMIT_GLOBAL_RPS: '1000',
      RATE_LIMIT_GLOBAL_BURST: '1000',
    });
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  const newUser = async () => (await seedUser(infra.databaseUrl, 'library')).apiKey;

  async function api<T>(key: string, path: string, init: RequestInit = {}) {
    const res = await fetch(`${gateway}${path}`, {
      ...init,
      headers: { 'x-api-key': key, 'content-type': 'application/json', ...init.headers },
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  async function upload(
    key: string,
    body: Buffer,
    { contentType = 'image/png', name }: { contentType?: string; name?: string } = {},
  ) {
    const res = await api<{ uploadUrl: string; sourceKey: string; assetId: string }>(
      key,
      '/v1/uploads',
      { method: 'POST', body: JSON.stringify({ contentType, size: body.length, name }) },
    );
    expect(res.status).toBe(200);
    const put = await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body,
    });
    expect(put.status).toBe(200);
    return res.body;
  }

  async function createJob(key: string, job: Record<string, unknown>) {
    const res = await api<{ jobId: string }>(key, '/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    });
    expect(res.status).toBe(202);
    return res.body.jobId;
  }

  const resize = (key: string, sourceKey: string) =>
    createJob(key, { type: 'image.resize', sourceKey, presets: ['thumb', 'medium'] });

  const succeeded = (key: string, jobId: string) =>
    waitFor(
      async () => {
        const { body } = await api<{ status: string }>(key, `/v1/jobs/${jobId}`);
        return body.status === 'succeeded';
      },
      { what: `job ${jobId} to succeed` },
    );

  const exists = (key: string) =>
    infra.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(
      () => true,
      () => false,
    );

  const countUnder = async (prefix: string) =>
    (await infra.s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }))).KeyCount ??
    0;

  /** The images in these tests are tiny, so a processed one fits well inside the quota. */
  async function processedImage(key: string, name = 'photo.png') {
    const asset = await upload(key, await pngImage(1200, 800), { name });
    const jobId = await resize(key, asset.sourceKey);
    await succeeded(key, jobId);
    return { ...asset, jobId };
  }

  it('lists an upload once a job used it, with a preview and what the job learned', async () => {
    const key = await newUser();
    const asset = await upload(key, await pngImage(1200, 800), { name: 'beach.png' });

    const before = await api<{ items: Summary[] }>(key, '/v1/assets');
    expect(before.body.items).toEqual([]);

    const jobId = await resize(key, asset.sourceKey);
    await succeeded(key, jobId);

    const { body } = await api<{ items: Summary[]; nextCursor: string | null }>(key, '/v1/assets');
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    const [item] = body.items;
    expect(item).toMatchObject({
      id: asset.assetId,
      kind: 'image',
      name: 'beach.png',
      width: 1200,
      height: 800,
      sourceKey: asset.sourceKey,
      latestJob: { id: jobId, status: 'succeeded' },
      preview: { width: 200, height: 133 },
    });
    expect(item?.size).toBeGreaterThan(0);
    expect((await fetch(item!.preview!.url)).status).toBe(200);
  });

  it('shows the original and the results of every job on the file', async () => {
    const key = await newUser();
    const { assetId, sourceKey, jobId: first } = await processedImage(key);
    const second = await createJob(key, {
      type: 'image.resize',
      sourceKey,
      presets: ['large'],
    });
    await succeeded(key, second);

    const { status, body } = await api<Details>(key, `/v1/assets/${assetId}`);
    expect(status).toBe(200);
    expect(body.jobs.map((j) => j.id)).toEqual([second, first]);
    expect(body.jobs.map((j) => j.results?.length)).toEqual([1, 2]);
    expect(body.jobsNextCursor).toBeNull();
    expect((await fetch(body.originalUrl)).status).toBe(200);
    expect((await fetch(body.jobs[1]!.results![0]!.url)).status).toBe(200);

    const history = await api<{ items: { id: string; assetId: string }[] }>(
      key,
      `/v1/jobs?assetId=${assetId}`,
    );
    expect(history.body.items.map((j) => [j.id, j.assetId])).toEqual([
      [second, assetId],
      [first, assetId],
    ]);
  });

  it('filters photos from videos and pages with a cursor', async () => {
    const key = await newUser();
    const images: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { sourceKey, assetId } = await upload(key, await pngImage(64, 64));
      await resize(key, sourceKey);
      images.push(assetId);
    }
    // No video worker runs here: the job stays queued, which is enough to list the file.
    const video = await upload(key, Buffer.from('not really a video'), {
      contentType: 'video/mp4',
    });
    await createJob(key, { type: 'video.frames', sourceKey: video.sourceKey });

    const videos = await api<{ items: Summary[] }>(key, '/v1/assets?kind=video');
    expect(videos.body.items.map((a) => [a.id, a.kind])).toEqual([[video.assetId, 'video']]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await api<{ items: Summary[]; nextCursor: string | null }>(
        key,
        `/v1/assets?limit=2${query}`,
      );
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.body.items.map((a) => a.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([video.assetId, ...images.reverse()]);
  });

  /** A job attaches the upload to the library; these tests do not wait for it to finish. */
  async function attached(key: string, name: string) {
    const asset = await upload(key, await pngImage(40, 30), { name });
    await resize(key, asset.sourceKey);
    return asset;
  }

  it('narrows the library by what the latest job says', async () => {
    const key = await newUser();
    const ready = await processedImage(key, 'ready.png');
    const failed = await processedImage(key, 'failed.png');
    await pool.query(`UPDATE jobs SET status = 'dead', dead_reason = 'permanent' WHERE id = $1`, [
      failed.jobId,
    ]);
    // No video worker runs here: the job stays queued.
    const video = await upload(key, Buffer.from('waits for a video worker'), {
      contentType: 'video/mp4',
      name: 'clip.mp4',
    });
    await createJob(key, { type: 'video.frames', sourceKey: video.sourceKey });

    const idsWith = async (status: string) =>
      (await api<{ items: Summary[] }>(key, `/v1/assets?status=${status}`)).body.items.map(
        (a) => a.id,
      );
    expect(await idsWith('ready')).toEqual([ready.assetId]);
    expect(await idsWith('failed')).toEqual([failed.assetId]);
    expect(await idsWith('processing')).toEqual([video.assetId]);
  });

  it('judges a file by its latest job, not an earlier one that succeeded', async () => {
    const key = await newUser();
    const { assetId, sourceKey, jobId: older } = await processedImage(key);
    const newer = await resize(key, sourceKey);
    await succeeded(key, newer);
    await pool.query(`UPDATE jobs SET status = 'dead', dead_reason = 'permanent' WHERE id = $1`, [
      newer,
    ]);
    await pool.query(
      `UPDATE jobs SET created_at = CASE id
         WHEN $1::uuid THEN now() - interval '2 minutes'
         WHEN $2::uuid THEN now() - interval '1 minute' END
       WHERE id IN ($1, $2)`,
      [older, newer],
    );

    const idsWith = async (status: string) =>
      (await api<{ items: Summary[] }>(key, `/v1/assets?status=${status}`)).body.items.map(
        (a) => a.id,
      );
    expect(await idsWith('failed')).toEqual([assetId]);
    expect(await idsWith('ready')).toEqual([]);
  });

  it('combines kind, status and name across pages', async () => {
    const key = await newUser();
    const matching: string[] = [];
    matching.push((await processedImage(key, 'trip-1.png')).assetId);
    // Differs in kind only: no video worker runs here, so the job is marked succeeded by hand.
    const video = await upload(key, Buffer.from('a video in name only'), {
      contentType: 'video/mp4',
      name: 'trip-clip.mp4',
    });
    const videoJob = await createJob(key, { type: 'video.frames', sourceKey: video.sourceKey });
    await pool.query(`UPDATE jobs SET status = 'succeeded' WHERE id = $1`, [videoJob]);
    matching.push((await processedImage(key, 'trip-2.png')).assetId);
    // Differs in status only.
    const broken = await processedImage(key, 'trip-broken.png');
    await pool.query(`UPDATE jobs SET status = 'dead', dead_reason = 'permanent' WHERE id = $1`, [
      broken.jobId,
    ]);
    matching.push((await processedImage(key, 'trip-3.png')).assetId);
    // Differs in name only.
    await processedImage(key, 'harbour.png');

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const after: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await api<{ items: Summary[]; nextCursor: string | null }>(
        key,
        `/v1/assets?kind=image&status=ready&q=trip&limit=2${after}`,
      );
      expect(page.status).toBe(200);
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.body.items.map((a) => a.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(matching.reverse());
  });

  it('finds files by part of the name, taking % and _ literally', async () => {
    const key = await newUser();
    await attached(key, 'Harbour at dawn.png');
    await attached(key, 'cliffs_100%.png');
    await attached(key, 'cliffsX100Y.png');

    const namesFor = async (q: string) =>
      (
        await api<{ items: Summary[] }>(key, `/v1/assets?q=${encodeURIComponent(q)}`)
      ).body.items.map((a) => a.name);
    expect(await namesFor('HARBOUR')).toEqual(['Harbour at dawn.png']);
    expect(await namesFor('_100%')).toEqual(['cliffs_100%.png']);
    expect(await namesFor('nothing like it')).toEqual([]);
  });

  it('takes a backslash in the search literally', async () => {
    const key = await newUser();
    await attached(key, 'a\\b.png');
    await attached(key, 'ab.png');

    const { body } = await api<{ items: Summary[] }>(
      key,
      `/v1/assets?q=${encodeURIComponent('\\')}`,
    );
    expect(body.items.map((a) => a.name)).toEqual(['a\\b.png']);
  });

  it('rejects an unknown status and an overlong search', async () => {
    const key = await newUser();
    expect((await api(key, '/v1/assets?status=done')).status).toBe(400);
    expect((await api(key, `/v1/assets?q=${'x'.repeat(101)}`)).status).toBe(400);
    const padded = encodeURIComponent(`  ${'x'.repeat(100)}  `);
    expect((await api(key, `/v1/assets?q=${padded}`)).status).toBe(200);
  });

  it("keeps another user's files and jobs out of reach", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const { assetId, sourceKey, jobId } = await processedImage(owner);

    const asset = await api<{ code?: string }>(stranger, `/v1/assets/${assetId}`);
    expect(asset.status).toBe(404);
    expect(asset.body.code).toBe('ASSET_NOT_FOUND');
    expect((await api(stranger, `/v1/assets/${assetId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api(stranger, `/v1/jobs/${jobId}`)).status).toBe(404);
    const jobs = await api<{ items: unknown[] }>(stranger, `/v1/jobs?assetId=${assetId}`);
    expect(jobs.body.items).toEqual([]);
    const reuse = await api(stranger, '/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ type: 'image.resize', sourceKey, presets: ['thumb'] }),
    });
    expect(reuse.status).toBe(400);

    expect((await api(owner, `/v1/assets/${assetId}`)).status).toBe(200);
  });

  it('deletes a file: gone from the library at once, from storage shortly after', async () => {
    const key = await newUser();
    const { assetId, sourceKey, jobId } = await processedImage(key);
    expect(await exists(sourceKey)).toBe(true);
    expect(await countUnder(`results/${jobId}/`)).toBe(2);

    expect((await api(key, `/v1/assets/${assetId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(key, `/v1/assets/${assetId}`)).status).toBe(404);
    expect((await api<{ items: Summary[] }>(key, '/v1/assets')).body.items).toEqual([]);

    await waitFor(async () => !(await exists(sourceKey)), { what: 'the original to be purged' });
    await waitFor(async () => (await countUnder(`results/${jobId}/`)) === 0, {
      what: 'the results to be purged',
    });
    expect((await api(key, `/v1/assets/${assetId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api(key, `/v1/jobs/${jobId}`)).status).toBe(200);
  });

  it('refuses to delete a file while a job on it is in progress', async () => {
    const key = await newUser();
    const video = await upload(key, Buffer.from('waits for a video worker'), {
      contentType: 'video/mp4',
    });
    await createJob(key, { type: 'video.frames', sourceKey: video.sourceKey });

    const res = await api<{ code: string }>(key, `/v1/assets/${video.assetId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_BUSY');
    expect(await exists(video.sourceKey)).toBe(true);
  });

  it('reserves quota at upload time and frees it on delete', async () => {
    const key = await newUser();
    const reserve = () =>
      api<{ assetId: string; code?: string; message: string }>(key, '/v1/uploads', {
        method: 'POST',
        body: JSON.stringify({ contentType: 'image/jpeg', size: MB3 }),
      });

    const first = await reserve();
    expect(first.status).toBe(200);
    const over = await reserve();
    expect(over.status).toBe(413);
    expect(over.body.code).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(over.body.message).toContain(`${MB3} of ${QUOTA_BYTES} bytes used`);

    expect((await api(key, `/v1/assets/${first.body.assetId}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await reserve()).status).toBe(200);
  });

  it('deletes uploads that no job used once they are old enough', async () => {
    const key = await newUser();
    const { assetId, sourceKey } = await upload(key, await pngImage(32, 32));
    await pool.query(`UPDATE assets SET created_at = now() - interval '2 days' WHERE id = $1`, [
      assetId,
    ]);

    await waitFor(
      async () => {
        const { rows } = await pool.query<{ deleted_at: Date | null }>(
          'SELECT deleted_at FROM assets WHERE id = $1',
          [assetId],
        );
        return rows[0]?.deleted_at;
      },
      { what: 'the janitor to delete the upload' },
    );
    await waitFor(async () => !(await exists(sourceKey)), { what: 'the upload to be purged' });
    const reuse = await api<{ code: string }>(key, '/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ type: 'image.resize', sourceKey, presets: ['thumb'] }),
    });
    expect(reuse.status).toBe(400);
  });

  it('backfills assets from jobs that read uploads before the library existed', async () => {
    const { userId } = await seedUser(infra.databaseUrl, 'legacy');
    const sourceKey = `uploads/${userId}/old.mp4`;
    const output = {
      durationSeconds: 3.5,
      width: 320,
      height: 240,
      codec: 'h264',
      preview: { key: 'p', atSeconds: 0, width: 320, height: 240, bytes: 1 },
      frames: [],
    };
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (user_id, type, priority, input, status, output, finished_at)
       VALUES ($1, 'video.frames', 5, $2, 'succeeded', $3, now()) RETURNING id`,
      [userId, { sourceKey }, output],
    );

    const sql = await readFile(
      join(__dirname, '../apps/metadata/drizzle/0009_backfill_assets.sql'),
      'utf8',
    );
    for (const statement of sql.split('--> statement-breakpoint')) await pool.query(statement);

    const { rows: assets } = await pool.query(
      `SELECT a.kind, a.content_type, a.size, a.width, a.height, a.duration_seconds,
              a.attached_at IS NOT NULL AS attached, j.asset_id = a.id AS linked
       FROM assets a JOIN jobs j ON j.id = $1 WHERE a.key = $2`,
      [rows[0]!.id, sourceKey],
    );
    expect(assets).toEqual([
      {
        kind: 'video',
        content_type: 'video/mp4',
        size: null,
        width: 320,
        height: 240,
        duration_seconds: 3.5,
        attached: true,
        linked: true,
      },
    ]);
  });
});
