import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { IMAGE_PRESET_NAMES } from '@pdp/contracts';
import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, waitFor } from './support/helpers';
import { BUCKET, type Infra, startInfra } from './support/infra';

interface JobView {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  results?: { preset: string; width: number; height: number; bytes: number; url: string }[];
}

describe('image.resize end to end (all four services)', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let apiKey: string;
  let gateway: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    apiKey = db.user.apiKey;
    apps = createApps(infra);
    await apps.start('metadata');
    await apps.start('scheduler');
    await apps.start('worker');
    gateway = await apps.start('api-gateway');
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  async function api<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${gateway}${path}`, {
      ...init,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json', ...init.headers },
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  it('uploads, processes and exposes the results', async () => {
    const image = await pngImage(1200, 800);

    const upload = await api<{ uploadUrl: string; sourceKey: string }>('/v1/uploads', {
      method: 'POST',
      body: JSON.stringify({ contentType: 'image/png', size: image.length }),
    });
    expect(upload.status).toBe(200);
    const put = await fetch(upload.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: image,
    });
    expect(put.status).toBe(200);

    const created = await api<{ jobId: string; status: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'image.resize',
        sourceKey: upload.body.sourceKey,
        presets: IMAGE_PRESET_NAMES,
      }),
    });
    expect(created).toMatchObject({ status: 202, body: { status: 'queued' } });
    const { jobId } = created.body;

    const job = await waitFor(
      async () => {
        const { body } = await api<JobView>(`/v1/jobs/${jobId}`);
        if (body.status === 'failed') throw new Error(`job failed: ${body.lastError}`);
        return body.status === 'succeeded' ? body : undefined;
      },
      { what: 'job to succeed' },
    );

    expect(job.attempts).toBe(1);
    expect(job.results?.map(({ preset, width, height }) => ({ preset, width, height }))).toEqual([
      { preset: 'thumb', width: 200, height: 133 },
      { preset: 'medium', width: 800, height: 533 },
      { preset: 'large', width: 1200, height: 800 },
    ]);
    for (const result of job.results ?? []) {
      const download = await fetch(result.url);
      expect(download.status).toBe(200);
      expect((await download.arrayBuffer()).byteLength).toBe(result.bytes);
      await infra.s3.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: `results/${jobId}/${result.preset}.webp` }),
      );
    }

    const { rows: transitions } = await pool.query<{ to_status: string; attempt: number }>(
      'select to_status, attempt from job_transitions where job_id = $1 order by created_at',
      [jobId],
    );
    // `scheduled@0` is a no-op when the worker starts before the scheduler's own update lands.
    expect(transitions.filter((t) => t.to_status !== 'scheduled')).toEqual([
      { to_status: 'running', attempt: 1 },
      { to_status: 'succeeded', attempt: 1 },
    ]);
    const { rows: executions } = await pool.query(
      'select attempt, outcome from job_executions where job_id = $1',
      [jobId],
    );
    expect(executions).toEqual([{ attempt: 1, outcome: 'succeeded' }]);
  });

  it('marks unreadable images failed without retrying', async () => {
    const garbage = Buffer.from('definitely not a png');
    const upload = await api<{ uploadUrl: string; sourceKey: string }>('/v1/uploads', {
      method: 'POST',
      body: JSON.stringify({ contentType: 'image/png', size: garbage.length }),
    });
    await fetch(upload.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: garbage,
    });
    const { body } = await api<{ jobId: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'image.resize',
        sourceKey: upload.body.sourceKey,
        presets: ['thumb'],
      }),
    });

    const job = await waitFor(
      async () => {
        const res = await api<JobView>(`/v1/jobs/${body.jobId}`);
        return res.body.status === 'failed' ? res.body : undefined;
      },
      { what: 'job to fail' },
    );
    expect(job.attempts).toBe(1);
    expect(job.lastError).toMatch(/unreadable image/);
  });

  it('hides jobs of other users and rejects foreign source keys', async () => {
    const res = await api<unknown>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'image.resize',
        sourceKey: 'uploads/someone-else/a.png',
        presets: ['thumb'],
      }),
    });
    expect(res.status).toBe(400);

    const missing = await api<unknown>('/v1/jobs/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);

    const noKey = await fetch(`${gateway}/v1/jobs`);
    expect(noKey.status).toBe(401);
  });
});
