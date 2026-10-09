import sharp from 'sharp';
import { PermanentError } from './permanent-error';
import { resizeImage } from './resize';

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .png()
    .toBuffer();

const options = { maxInputPixels: 50_000_000 };

describe('resizeImage', () => {
  it('produces webp per preset, keeping the aspect ratio', async () => {
    const results = await resizeImage(await png(2000, 1000), ['thumb', 'medium'], options);

    expect(results.map(({ preset, width, height }) => ({ preset, width, height }))).toEqual([
      { preset: 'thumb', width: 200, height: 100 },
      { preset: 'medium', width: 800, height: 400 },
    ]);
    const meta = await sharp(results[0]!.data).metadata();
    expect(meta.format).toBe('webp');
  });

  it('does not upscale small images', async () => {
    const [large] = await resizeImage(await png(300, 150), ['large'], options);
    expect(large).toMatchObject({ width: 300, height: 150 });
  });

  it('applies EXIF orientation', async () => {
    const rotated = await sharp(await png(400, 200))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const [thumb] = await resizeImage(rotated, ['thumb'], options);
    expect(thumb).toMatchObject({ width: 200, height: 400 });
  });

  it('treats unreadable input as permanent', async () => {
    await expect(resizeImage(Buffer.from('not an image'), ['thumb'], options)).rejects.toThrow(
      PermanentError,
    );
  });

  it('treats images over the pixel limit as permanent', async () => {
    await expect(
      resizeImage(await png(100, 100), ['thumb'], { maxInputPixels: 9_999 }),
    ).rejects.toThrow(PermanentError);
  });
});
