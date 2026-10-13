import { type JobDto } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { startFileServer, type FileServer } from './support/file-server';
import { pngImage, prepareDatabase, waitFor } from './support/helpers';
import { type Infra, startInfra } from './support/infra';
import { FFMPEG_ENV, makeVideo } from './support/media';

interface Frame {
  atSeconds: number;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

interface JobView {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  deadReason: string | null;
  results?: { preset: string; url: string }[];
  progress: number | null;
  video?: {
    durationSeconds: number;
    width: number;
    height: number;
    codec: string;
    preview: Frame;
    frames: Frame[];
  };
  transcode?: {
    durationSeconds: number;
    width: number;
    height: number;
    preview: Frame;
    renditions: {
      rendition: string;
      width: number;
      height: number;
      durationSeconds: number;
      bytes: number;
      bitrate: number;
      url: string;
    }[];
    skipped: string[];
  };
}

describe('video jobs and sources by URL', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let apiKey: string;
  let userId: string;
  let gateway: string;
  let metadata: MetadataClient;
  let files: FileServer;
  let clip: Buffer;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    ({ apiKey, userId } = db.user);
    clip = await makeVideo(5);
    const png = await pngImage(400, 300);
    files = await startFileServer({
      '/clip.mp4': { body: clip, type: 'video/mp4' },
      '/photo.png': { body: png, type: 'image/png' },
      '/to-loopback': { redirect: 'http://127.0.0.1:1/photo.png' },
    });

    apps = createApps(infra);
    metadata = new MetadataClient({ baseUrl: await apps.start('metadata'), timeoutMs: 5000 });
    await apps.start('scheduler');
    // `localhost` stands in for a public host; literal private addresses stay blocked.
    const egress = { EGRESS_PRIVATE_HOSTS: 'localhost', WORKER_RETRY_BASE_MS: '50' };
    await apps.start('worker', egress);
    await apps.start('video-worker', { ...egress, ...FFMPEG_ENV });
    gateway = await apps.start('api-gateway', egress);
  });

  afterAll(async () => {
    await apps?.stopAll();
    await files?.close();
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

  async function upload(body: Buffer, contentType: string): Promise<string> {
    const res = await api<{ uploadUrl: string; sourceKey: string }>('/v1/uploads', {
      method: 'POST',
      body: JSON.stringify({ contentType, size: body.length }),
    });
    expect(res.status).toBe(200);
    const put = await fetch(res.body.uploadUrl, {
      method: 'PUT',
      body: body,
      headers: { 'content-type': contentType },
    });
    expect(put.status).toBe(200);
    return res.body.sourceKey;
  }

  async function createJob(body: Record<string, unknown>): Promise<string> {
    const res = await api<{ jobId: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(202);
    return res.body.jobId;
  }

  const finished = (id: string) =>
    waitFor(
      async () => {
        const { body } = await api<JobView>(`/v1/jobs/${id}`);
        return body.status === 'succeeded' || body.status === 'dead' ? body : undefined;
      },
      { what: `job ${id} to finish`, timeoutMs: 60_000, intervalMs: 200 },
    );

  const finishedInternal = (id: string) =>
    waitFor(
      async () => {
        const job = await metadata.getJob(id);
        return job.status === 'succeeded' || job.status === 'dead' ? job : undefined;
      },
      { what: `job ${id} to finish`, timeoutMs: 30_000 },
    );

  it('extracts a preview and frames from an uploaded video', async () => {
    const sourceKey = await upload(clip, 'video/mp4');
    const job = await finished(
      await createJob({ type: 'video.frames', sourceKey, intervalSeconds: 1, maxFrames: 3 }),
    );

    expect(job).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(job.video).toMatchObject({ codec: 'h264', width: 320, height: 240 });
    expect(job.video?.durationSeconds).toBeCloseTo(5, 0);
    expect(job.video?.frames.map((f) => f.atSeconds)).toEqual([0, 1, 2]);
    // Smaller than the frame width: kept as is, not upscaled.
    expect(job.video?.preview).toMatchObject({ atSeconds: 1, width: 320, height: 240 });

    const preview = Buffer.from(await (await fetch(job.video!.preview.url)).arrayBuffer());
    expect(preview.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(preview.length).toBe(job.video?.preview.bytes);
  });

  it('transcodes a video into both renditions in one pass', async () => {
    const sourceKey = await upload(await makeVideo(3, 1280, 720), 'video/mp4');
    const job = await finished(await createJob({ type: 'video.transcode', sourceKey }));

    expect(job).toMatchObject({ status: 'succeeded', attempts: 1, progress: null });
    expect(job.transcode).toMatchObject({ width: 1280, height: 720, skipped: [] });
    expect(job.transcode?.renditions.map((r) => [r.rendition, r.width, r.height])).toEqual([
      ['480p', 854, 480],
      ['720p', 1280, 720],
    ]);
    for (const r of job.transcode!.renditions) {
      expect(r.durationSeconds).toBeCloseTo(3, 0);
      const file = Buffer.from(await (await fetch(r.url)).arrayBuffer());
      expect(file.length).toBe(r.bytes);
      expect(r.bitrate).toBe(Math.round((r.bytes * 8) / r.durationSeconds));
      // +faststart: the index (moov) comes before the media data, so playback starts at once.
      expect(file.indexOf('moov')).toBeLessThan(file.indexOf('mdat'));
    }
  });

  it('skips renditions larger than the source and does not upscale', async () => {
    const sourceKey = await upload(await makeVideo(2, 854, 480), 'video/mp4');
    const job = await finished(await createJob({ type: 'video.transcode', sourceKey }));
    expect(job.status).toBe('succeeded');
    expect(job.transcode?.renditions.map((r) => r.rendition)).toEqual(['480p']);
    expect(job.transcode?.skipped).toEqual(['720p']);

    const tiny = await finished(
      await createJob({ type: 'video.transcode', sourceKey: await upload(clip, 'video/mp4') }),
    );
    expect(tiny).toMatchObject({ status: 'dead', deadReason: 'permanent', attempts: 1 });
    expect(tiny.lastError).toContain('not upscaled');
  });

  it('rejects a video over 60 seconds permanently', async () => {
    const sourceKey = await upload(await makeVideo(61, 32, 32), 'video/mp4');
    const job = await finished(await createJob({ type: 'video.frames', sourceKey }));
    expect(job).toMatchObject({ status: 'dead', deadReason: 'permanent', attempts: 1 });
    expect(job.lastError).toContain('limit 60s');
  });

  it('rejects a file that is not a supported video permanently', async () => {
    const sourceKey = await upload(await pngImage(64, 64), 'video/mp4');
    const job = await finished(await createJob({ type: 'video.frames', sourceKey }));
    expect(job).toMatchObject({ status: 'dead', deadReason: 'permanent' });
  });

  it('fetches video and image sources by URL', async () => {
    const base = `http://localhost:${files.port}`;
    const video = await finished(
      await createJob({ type: 'video.frames', sourceUrl: `${base}/clip.mp4`, maxFrames: 2 }),
    );
    expect(video.status).toBe('succeeded');
    expect(video.video?.frames).toHaveLength(2);

    const image = await finished(
      await createJob({ type: 'image.resize', sourceUrl: `${base}/photo.png`, presets: ['thumb'] }),
    );
    expect(image.status).toBe('succeeded');
    expect(image.results?.map((r) => r.preset)).toEqual(['thumb']);
  });

  it.each([
    ['a loopback address', (port: number) => `http://127.0.0.1:${port}/photo.png`],
    ['cloud metadata', () => 'http://169.254.169.254/latest/meta-data/'],
    ['a non-http scheme', () => 'file:///etc/passwd'],
  ])('refuses %s at the gateway', async (_name, url) => {
    const res = await api<{ message: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'image.resize',
        sourceUrl: url(files.port),
        presets: ['thumb'],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('refuses private addresses in the worker too, including after a redirect', async () => {
    const hitsBefore = files.hits.length;
    const create = async (sourceUrl: string): Promise<JobDto> => {
      const { job } = await metadata.createJob({
        userId,
        type: 'image.resize',
        input: { sourceUrl, presets: ['thumb'] },
      });
      return finishedInternal(job.id);
    };

    const direct = await create(`http://127.0.0.1:${files.port}/photo.png`);
    expect(direct).toMatchObject({ status: 'dead', deadReason: 'permanent', attempts: 1 });
    expect(direct.lastError).toContain('not a public address');
    expect(files.hits.length).toBe(hitsBefore);

    const redirected = await create(`http://localhost:${files.port}/to-loopback`);
    expect(redirected).toMatchObject({ status: 'dead', deadReason: 'permanent' });
    expect(redirected.lastError).toContain('not a public address');
  });

  it('treats a missing remote source as permanent', async () => {
    const id = await createJob({
      type: 'image.resize',
      sourceUrl: `http://localhost:${files.port}/missing.png`,
      presets: ['thumb'],
    });
    const job = await finished(id);
    expect(job).toMatchObject({ status: 'dead', deadReason: 'permanent' });
    expect(job.lastError).toContain('responded 404');
  });
});
