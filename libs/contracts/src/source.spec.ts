import { ImageResizeInputV1 } from './image-resize';
import { VideoFramesInputV1 } from './video-frames';

describe('media source', () => {
  it('accepts exactly one of sourceKey and sourceUrl', () => {
    expect(ImageResizeInputV1.safeParse({ sourceKey: 'k', presets: ['thumb'] }).success).toBe(true);
    expect(
      ImageResizeInputV1.safeParse({ sourceUrl: 'https://example.com/a.png', presets: ['thumb'] })
        .success,
    ).toBe(true);
    expect(ImageResizeInputV1.safeParse({ presets: ['thumb'] }).success).toBe(false);
    expect(
      ImageResizeInputV1.safeParse({
        sourceKey: 'k',
        sourceUrl: 'https://example.com/a.png',
        presets: ['thumb'],
      }).success,
    ).toBe(false);
  });

  it.each(['ftp://example.com/a.mp4', 'file:///etc/passwd', 'not a url'])(
    'rejects %s',
    (sourceUrl) => {
      expect(VideoFramesInputV1.safeParse({ sourceUrl }).success).toBe(false);
    },
  );

  it('fills video defaults', () => {
    expect(VideoFramesInputV1.parse({ sourceKey: 'k' })).toEqual({
      sourceKey: 'k',
      intervalSeconds: 2,
      maxFrames: 10,
    });
  });
});
