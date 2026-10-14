import { assetKindOf, previewOf, sourceFactsOf } from './assets';

const frame = (key: string, width = 640, height = 360) => ({
  key,
  atSeconds: 0,
  width,
  height,
  bytes: 1000,
});

const video = { durationSeconds: 12.5, width: 1280, height: 720, codec: 'h264' };

describe('assetKindOf', () => {
  it('tells videos from images by content type', () => {
    expect(assetKindOf('video/quicktime')).toBe('video');
    expect(assetKindOf('image/webp')).toBe('image');
  });
});

describe('previewOf', () => {
  it('picks the smallest resized image', () => {
    const output = {
      results: [
        { preset: 'large', key: 'r/large.webp', width: 1600, height: 900, bytes: 9 },
        { preset: 'thumb', key: 'r/thumb.webp', width: 200, height: 113, bytes: 1 },
      ],
    };
    expect(previewOf('image.resize', output)).toEqual({
      key: 'r/thumb.webp',
      width: 200,
      height: 113,
    });
  });

  it('uses the preview frame of video jobs', () => {
    const output = { ...video, preview: frame('r/preview.jpg'), frames: [] };
    expect(previewOf('video.frames', output)).toEqual({
      key: 'r/preview.jpg',
      width: 640,
      height: 360,
    });
  });

  it('returns null for outputs it does not recognise', () => {
    expect(previewOf('image.resize', { results: [] })).toBeNull();
    expect(previewOf('video.transcode', { nope: true })).toBeNull();
    expect(previewOf('webhook.deliver', { statusCode: 200 })).toBeNull();
  });
});

describe('sourceFactsOf', () => {
  it('reads the original size of an image when the worker reported it', () => {
    expect(
      sourceFactsOf('image.resize', { results: [], source: { width: 4000, height: 3000 } }),
    ).toEqual({ width: 4000, height: 3000, durationSeconds: null });
    expect(sourceFactsOf('image.resize', { results: [] })).toBeNull();
  });

  it('reads size and duration of a video', () => {
    const output = {
      ...video,
      preview: frame('p'),
      renditions: [
        {
          rendition: '480p',
          key: 'r/480p.mp4',
          width: 854,
          height: 480,
          durationSeconds: 12.5,
          bytes: 10,
          bitrate: 1000,
        },
      ],
      skipped: [],
    };
    expect(sourceFactsOf('video.transcode', output)).toEqual({
      width: 1280,
      height: 720,
      durationSeconds: 12.5,
    });
  });
});
