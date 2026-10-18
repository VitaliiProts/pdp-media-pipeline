import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { VideoDubOutputV1 } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Pool } from 'pg';
import { seedUser } from '../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from './support/apps';
import { prepareDatabase, registerUpload, waitFor } from './support/helpers';
import { BUCKET, type Infra, startInfra } from './support/infra';
import { FFMPEG_ENV, makeVideo } from './support/media';

/** Recognition, translation, voices and separation stand-ins; ffmpeg and the pipeline are real. */
const FAKE_DUB_ENV = {
  VIDEO_JOB_TYPES: 'video.dub',
  DUB_PROVIDERS: 'fake',
  DUB_TTS: 'fake',
  DUB_AUDIO_SEPARATE: 'fake',
  WORKER_RETRY_BASE_MS: '50',
  JOB_PROGRESS_INTERVAL_MS: '100',
};

describe('video dubbing', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let userId: string;
  let metadata: MetadataClient;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    ({ userId } = db.user);
    apps = createApps(infra);
    metadata = new MetadataClient({ baseUrl: await apps.start('metadata'), timeoutMs: 5000 });
    await apps.start('scheduler');
    await apps.start('video-worker', { ...FFMPEG_ENV, ...FAKE_DUB_ENV });
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  async function upload(name: string, body: Buffer): Promise<string> {
    const key = `uploads/${userId}/${name}`;
    await infra.s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'video/mp4' }),
    );
    await registerUpload(pool, key, body.length);
    return key;
  }

  async function dub(sourceKey: string) {
    const { job } = await metadata.createJob({
      userId,
      type: 'video.dub',
      input: { sourceKey, targetLanguage: 'uk' },
    });
    return waitFor(
      async () => {
        const current = await metadata.getJob(job.id);
        return current.status === 'succeeded' || current.status === 'dead' ? current : undefined;
      },
      { what: `dub ${job.id} to finish`, timeoutMs: 60_000, intervalMs: 200 },
    );
  }

  const stored = (key: string) =>
    infra.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(
      () => true,
      () => false,
    );

  it('dubs a clip into a video with the dub and the original as two audio tracks', async () => {
    const job = await dub(await upload('talk.mp4', await makeVideo(8, 320, 240, { audio: true })));

    // The gateway shows the step of a running job only; Metadata keeps the last one.
    expect(job).toMatchObject({ status: 'succeeded', attempts: 1, progressStep: 'mix' });
    const output = VideoDubOutputV1.parse(job.output);
    expect(output).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'uk' });
    expect(output.durationSeconds).toBeCloseTo(8, 0);
    expect(output.phrases.map((p) => p.speaker)).toEqual(['A', 'B']);
    expect(output.speakers.map((s) => [s.gender, s.voice])).toEqual([
      ['male', 'M1'],
      ['female', 'F1'],
    ]);
    for (const name of ['audio.flac', 'transcript.json', 'vocals.flac', 'analysis.json']) {
      expect(await stored(`results/${job.id}/dub/${name}`)).toBe(true);
    }
    expect(await stored(output.subtitles.key)).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), 'pdp-dub-'));
    try {
      const res = await infra.s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: output.video.key }),
      );
      const video = Buffer.from(await res.Body!.transformToByteArray());
      expect(video.length).toBe(output.video.bytes);
      const path = join(dir, 'dubbed.mp4');
      await writeFile(path, video);
      const { stdout } = await promisify(execFile)(FFMPEG_ENV.FFPROBE_PATH, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        path,
      ]);
      const streams = (
        JSON.parse(stdout) as {
          streams: {
            codec_type: string;
            tags?: { language?: string };
            disposition: { default: number };
          }[];
        }
      ).streams;
      expect(
        streams.map((s) => [s.codec_type, s.tags?.language ?? null, s.disposition.default]),
      ).toEqual([
        ['video', expect.anything(), 1],
        ['audio', 'ukr', 1],
        ['audio', 'eng', 0],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses only a dub of the same file by the same user', async () => {
    const talk = await upload('reuse.mp4', await makeVideo(8, 320, 240, { audio: true }));
    const first = await dub(talk);
    const other = await seedUser(infra.databaseUrl, 'dub-other');
    const otherKey = `uploads/${other.userId}/talk.mp4`;
    await registerUpload(pool, otherKey);
    const frames = await metadata.createJob({
      userId,
      type: 'video.frames',
      input: { sourceKey: talk },
    });
    const create = (owner: string, sourceKey: string, reuseOf: string) =>
      metadata.createJob({
        userId: owner,
        type: 'video.dub',
        input: { sourceKey, targetLanguage: 'de', reuseOf },
      });
    const rejected = { status: 400, code: 'VALIDATION_FAILED' };

    await expect(create(other.userId, otherKey, first.id)).rejects.toMatchObject(rejected);
    await expect(
      create(userId, await upload('else.mp4', await makeVideo(2)), first.id),
    ).rejects.toMatchObject(rejected);
    await expect(create(userId, talk, frames.job.id)).rejects.toMatchObject(rejected);
    await expect(
      create(userId, talk, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject(rejected);

    const reused = await create(userId, talk, first.id);
    expect(reused.job.input).toMatchObject({ reuseOf: first.id });
  });

  it('rejects a video without sound permanently with no_audio', async () => {
    const job = await dub(await upload('silent.mp4', await makeVideo(3)));

    expect(job).toMatchObject({ status: 'dead', deadReason: 'permanent', attempts: 1 });
    expect(job.lastError).toMatch(/^no_audio: /);
  });
});
