import { type AssetFrame, type AssetJob, playableOf } from '../../../features/assets';
import { dubJob, TEST_DUB } from '../../../test/dub-fixtures';
import { formatOf, framesOf, versionsOf } from './versions';

const frame = (atSeconds: number, name: string): AssetFrame => ({
  atSeconds,
  width: 640,
  height: 360,
  bytes: 20_000,
  url: `http://storage.test/${name}.jpg`,
  downloadUrl: `http://storage.test/${name}.jpg?dl`,
});

const job = (overrides: Partial<AssetJob>): AssetJob => ({
  id: 'j1',
  type: 'image.resize',
  status: 'succeeded',
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

describe('versions of a file', () => {
  it('lists results of succeeded jobs only, newest job first', () => {
    const jobs = [
      job({
        id: 'j2',
        type: 'video.transcode',
        transcode: {
          durationSeconds: 12,
          width: 1280,
          height: 720,
          codec: 'h264',
          preview: frame(0, 'preview'),
          renditions: [
            {
              rendition: '480p',
              width: 854,
              height: 480,
              durationSeconds: 12,
              bytes: 1,
              bitrate: 1,
              url: 'http://storage.test/480p.mp4',
              downloadUrl: 'd480',
            },
            {
              rendition: '720p',
              width: 1280,
              height: 720,
              durationSeconds: 12,
              bytes: 2,
              bitrate: 2,
              url: 'http://storage.test/720p.mp4',
              downloadUrl: 'd720',
            },
          ],
        },
      }),
      job({ id: 'j3', status: 'running' }),
      job({
        id: 'j1',
        results: [
          {
            preset: 'thumb',
            width: 200,
            height: 133,
            bytes: 9,
            url: 'http://storage.test/t.webp',
            downloadUrl: 'dt',
          },
        ],
      }),
    ];

    expect(versionsOf(jobs).map((v) => [v.id, v.kind])).toEqual([
      ['j2:720p', 'rendition'],
      ['j2:480p', 'rendition'],
      ['j2:preview', 'preview'],
      ['j1:thumb', 'image'],
    ]);
    expect(playableOf(jobs)).toEqual({
      renditions: [
        expect.objectContaining({ rendition: '720p' }),
        expect.objectContaining({ rendition: '480p' }),
      ],
      poster: 'http://storage.test/preview.jpg',
    });
  });

  it('counts each finished dub as a version, not an unfinished one', () => {
    const jobs = [dubJob({ id: 'd2', status: 'running', dub: undefined }), dubJob({ id: 'd1' })];
    expect(versionsOf(jobs)).toEqual([
      {
        id: 'd1:dub',
        kind: 'dub',
        jobId: 'd1',
        language: 'de',
        durationSeconds: TEST_DUB.durationSeconds,
        bytes: TEST_DUB.video.bytes,
        url: TEST_DUB.video.url,
        downloadUrl: TEST_DUB.video.downloadUrl,
      },
    ]);
    expect(playableOf(jobs)).toEqual({ renditions: [], poster: null });
  });

  it('takes frames from the newest frames job', () => {
    const jobs = [
      job({
        id: 'j2',
        type: 'video.frames',
        video: {
          durationSeconds: 4,
          width: 640,
          height: 360,
          codec: 'h264',
          preview: frame(0, 'p2'),
          frames: [frame(0, 'a'), frame(2, 'b')],
        },
      }),
      job({
        id: 'j1',
        type: 'video.frames',
        video: {
          durationSeconds: 4,
          width: 640,
          height: 360,
          codec: 'h264',
          preview: frame(0, 'p1'),
          frames: [frame(0, 'old')],
        },
      }),
    ];
    expect(framesOf(jobs).map((f) => f.url)).toEqual([
      'http://storage.test/a.jpg',
      'http://storage.test/b.jpg',
    ]);
    expect(playableOf(jobs)).toEqual({ renditions: [], poster: 'http://storage.test/p2.jpg' });
  });

  it('names the format after the file extension', () => {
    expect(formatOf('http://storage.test/r/thumb.webp?X-Amz-Signature=1')).toBe('WebP');
    expect(formatOf('http://storage.test/r/480p.mp4')).toBe('MP4');
    expect(formatOf('http://storage.test/r/frame-0001.jpg')).toBe('JPEG');
    expect(formatOf('http://storage.test/r/x.avif')).toBe('AVIF');
  });

  it('names no format for a file without an extension', () => {
    expect(formatOf('http://storage.test/r/thumb?X-Amz-Signature=1')).toBe('');
    expect(formatOf('http://storage.test/r.v2/thumb')).toBe('');
  });
});
