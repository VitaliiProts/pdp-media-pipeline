import { ConfigService } from '@nestjs/config';
import { type JobDto } from '@pdp/contracts';
import { type Env } from '../config';
import { StorageService } from '../storage/storage.service';
import { downloadNameOf, JobPresenter, originalNameOf } from './job-presenter';

describe('download names', () => {
  it('uses the uploaded name, or the last part of the key', () => {
    expect(originalNameOf({ name: 'Harbour.JPG', key: 'u/1/abc' })).toBe('Harbour.JPG');
    expect(originalNameOf({ name: null, key: 'u/1/abc.png' })).toBe('abc.png');
  });

  it('names a version after the original, with a suffix and the format of the version', () => {
    expect(downloadNameOf('Harbour.JPG', 'thumb', 'r/1/thumb.webp')).toBe('Harbour-thumb.webp');
    expect(downloadNameOf('clip.final.mp4', '480p', 'r/1/480p.mp4')).toBe('clip.final-480p.mp4');
    expect(downloadNameOf('noext', 'preview', 'r/1/preview.jpg')).toBe('noext-preview.jpg');
    expect(downloadNameOf('.hidden', 'thumb', 'r/1/thumb')).toBe('.hidden-thumb');
  });
});

describe('JobPresenter', () => {
  const storage = new StorageService(
    new ConfigService<Env, true>({
      S3_BUCKET: 'media',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    }),
  );
  const presenter = new JobPresenter(storage);
  afterAll(() => storage.onApplicationShutdown());

  const frame = (key: string) => ({ key, atSeconds: 0, width: 320, height: 240, bytes: 1 });
  const job = (type: JobDto['type'], output: Record<string, unknown>): JobDto => ({
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    type,
    class: null,
    status: 'succeeded',
    priority: 5,
    input: {},
    output,
    attempts: 1,
    attemptBase: 0,
    deadReason: null,
    lastError: null,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    traceId: null,
    progress: null,
    progressStep: null,
    assetId: null,
  });
  const video = { durationSeconds: 3, width: 320, height: 240, codec: 'h264' };
  const savedAs = (url: string | undefined) =>
    new URL(url ?? 'http://missing').searchParams.get('response-content-disposition');

  it('names the preview, each frame from 0001 and each rendition', async () => {
    const frames = await presenter.toResponse(
      job('video.frames', {
        ...video,
        preview: frame('results/j/preview.jpg'),
        frames: [frame('results/j/frames/0001.jpg'), frame('results/j/frames/0002.jpg')],
      }),
      { downloadBase: 'clip.mp4' },
    );
    expect(savedAs(frames.video?.preview.downloadUrl)).toBe(
      "attachment; filename*=UTF-8''clip-preview.jpg",
    );
    expect(frames.video?.frames.map((f) => savedAs(f.downloadUrl))).toEqual([
      "attachment; filename*=UTF-8''clip-frame-0001.jpg",
      "attachment; filename*=UTF-8''clip-frame-0002.jpg",
    ]);

    const transcode = await presenter.toResponse(
      job('video.transcode', {
        ...video,
        preview: frame('results/j/preview.jpg'),
        renditions: [
          {
            rendition: '480p',
            key: 'results/j/480p.mp4',
            width: 640,
            height: 480,
            durationSeconds: 3,
            bytes: 1,
            bitrate: 1,
          },
        ],
        skipped: [],
      }),
      { downloadBase: "Dad's (best) clip.mp4" },
    );
    expect(savedAs(transcode.transcode?.renditions[0]?.downloadUrl)).toBe(
      "attachment; filename*=UTF-8''Dad%27s%20%28best%29%20clip-480p.mp4",
    );
  });

  it('adds no download links unless asked to', async () => {
    const response = await presenter.toResponse(
      job('video.frames', {
        ...video,
        preview: frame('results/j/preview.jpg'),
        frames: [frame('results/j/frames/0001.jpg')],
      }),
    );
    expect(response.video?.preview.url).toBeDefined();
    expect(response.video?.preview).not.toHaveProperty('downloadUrl');
    expect(response.video?.frames[0]).not.toHaveProperty('downloadUrl');
  });

  it('links the dubbed video and subtitles, without the provider usage', async () => {
    const response = await presenter.toResponse(
      job('video.dub', {
        durationSeconds: 8,
        sourceLanguage: 'en',
        targetLanguage: 'uk',
        video: { key: 'results/j/dubbed.mp4', bytes: 1000 },
        subtitles: { key: 'results/j/dubbed.vtt' },
        speakers: [{ id: 'A', gender: 'male', maleProbability: 0.9, voice: 'M1', seconds: 2 }],
        phrases: [
          {
            id: '1',
            turn: '1',
            speaker: 'A',
            start: 0.5,
            end: 3,
            source: 'Hi.',
            target: 'Привіт.',
            placedStart: 0.5,
            placedEnd: 3,
            speed: 1.1,
            refitted: false,
          },
        ],
        unrecognized: [{ start: 7, end: 8 }],
        stats: { phrases: 1, sped: 1, refitted: 0, overflowed: 0, meanEndErrorSeconds: 0 },
        usage: { audioSeconds: 8, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 },
      }),
      { downloadBase: 'clip.mp4' },
    );

    expect(response.dub).toMatchObject({
      sourceLanguage: 'en',
      video: { bytes: 1000 },
      phrases: [{ target: 'Привіт.' }],
      unrecognized: [{ start: 7, end: 8 }],
    });
    expect(response.dub).not.toHaveProperty('usage');
    expect(response.dub?.video).not.toHaveProperty('key');
    expect(new URL(response.dub?.video.url ?? '').pathname).toBe('/media/results/j/dubbed.mp4');
    expect(savedAs(response.dub?.video.downloadUrl)).toBe(
      "attachment; filename*=UTF-8''clip-dub-uk.mp4",
    );
    expect(savedAs(response.dub?.subtitles.downloadUrl)).toBe(
      "attachment; filename*=UTF-8''clip-dub-uk.vtt",
    );
  });

  it('shows the step only while the job runs', async () => {
    const stored = { ...job('video.dub', {}), progress: 45, progressStep: 'align' };
    await expect(
      presenter.toResponse({ ...stored, status: 'running', finishedAt: null }),
    ).resolves.toMatchObject({ progress: 45, progressStep: 'align' });
    await expect(presenter.toResponse({ ...stored, status: 'dead' })).resolves.toMatchObject({
      progress: null,
      progressStep: null,
    });
  });
});
