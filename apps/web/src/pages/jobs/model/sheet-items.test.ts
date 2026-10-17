import { type Job } from '../../../features/jobs';
import { type Upload } from '../../../features/upload';
import { buildSheetItems } from './sheet-items';

const base = { fileName: 'cat.png', kind: 'image', previewUrl: 'blob:cat', createdAt: 1 } as const;

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  type: 'image.resize',
  status: 'running',
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

describe('buildSheetItems', () => {
  it('puts uploads in flight before server jobs', () => {
    const uploads: Upload[] = [{ ...base, id: 'u1', phase: 'uploading', progress: 0.4 }];
    const items = buildSheetItems([job()], uploads);
    expect(items.map((i) => i.key)).toEqual(['upload:u1', 'job:job-1']);
    expect(items[0]).toMatchObject({ stage: { phase: 'uploading', progress: 0.4 } });
  });

  it('shows a submitted upload only through its job, with the local name and preview', () => {
    const uploads: Upload[] = [{ ...base, id: 'u1', phase: 'submitted', jobId: 'job-1' }];
    expect(buildSheetItems([job()], uploads)).toEqual([
      expect.objectContaining({ kind: 'job', title: 'cat.png', previewUrl: 'blob:cat' }),
    ]);
  });

  it('prefers the medium result as preview once the job succeeded', () => {
    const results = [
      { preset: 'thumb', width: 200, height: 100, bytes: 10, url: 'https://s3/thumb' },
      { preset: 'medium', width: 800, height: 400, bytes: 20, url: 'https://s3/medium' },
    ];
    const [item] = buildSheetItems([job({ status: 'succeeded', results })], []);
    expect(item).toMatchObject({ previewUrl: 'https://s3/medium', title: null });
  });

  it('shows the preview and frames of a finished video', () => {
    const frame = (atSeconds: number) => ({
      atSeconds,
      width: 640,
      height: 360,
      bytes: 100,
      url: `https://s3/frame-${atSeconds}`,
    });
    const video = {
      durationSeconds: 4,
      width: 1280,
      height: 720,
      codec: 'h264',
      preview: { ...frame(1), url: 'https://s3/preview' },
      frames: [frame(0), frame(2)],
    };
    const [item] = buildSheetItems([job({ type: 'video.frames', status: 'succeeded', video })], []);
    expect(item).toMatchObject({ previewUrl: 'https://s3/preview', results: [] });
    expect(item?.kind === 'job' && item.frames.map((f) => f.atSeconds)).toEqual([0, 2]);
  });

  it('shows the progress of a running job as a fraction, and none once it finished', () => {
    const running = job({ type: 'video.transcode', progress: 40 });
    expect(buildSheetItems([running], [])[0]).toMatchObject({ progress: 0.4 });
    const done = job({ type: 'video.transcode', status: 'succeeded', progress: 40 });
    expect(buildSheetItems([done], [])[0]).toMatchObject({ progress: null });
  });

  it('lists the renditions of a finished transcode as results', () => {
    const transcode = {
      durationSeconds: 4,
      width: 1920,
      height: 1080,
      codec: 'h264',
      preview: { atSeconds: 1, width: 640, height: 360, bytes: 100, url: 'https://s3/preview' },
      renditions: [
        {
          rendition: '480p' as const,
          width: 854,
          height: 480,
          durationSeconds: 4,
          bytes: 1_000,
          bitrate: 2_000,
          url: 'https://s3/480p.mp4',
        },
      ],
      skipped: [],
    };
    const [item] = buildSheetItems(
      [job({ type: 'video.transcode', status: 'succeeded', transcode })],
      [],
    );
    expect(item).toMatchObject({
      previewUrl: 'https://s3/preview',
      results: [
        { preset: '480p', width: 854, height: 480, bytes: 1_000, url: 'https://s3/480p.mp4' },
      ],
    });
  });

  it('keeps failed uploads with their problem', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'failed', problem: 'size', detail: null },
    ];
    expect(buildSheetItems([], uploads)[0]).toMatchObject({
      stage: { phase: 'failed', problem: 'size' },
    });
  });
});
