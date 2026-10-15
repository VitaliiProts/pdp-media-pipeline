import { IMAGE_PRESETS, type ImagePreset } from '@pdp/contracts';
import sharp from 'sharp';
import { traced } from '@pdp/observability';
import { PermanentError } from '@pdp/worker-kit';

// libvips threads would multiply on top of our own per-message concurrency.
sharp.concurrency(1);

export interface ResizedImage {
  preset: ImagePreset;
  width: number;
  height: number;
  data: Buffer;
}

export interface ResizeOptions {
  maxInputPixels: number;
  quality?: number;
}

export interface ResizeResult {
  /** The original as displayed, EXIF orientation applied like in the outputs. */
  source: { width: number; height: number };
  images: ResizedImage[];
}

/**
 * Validates the header before decoding: unreadable or oversized input is a
 * permanent failure, while errors during the resize itself may be retried.
 */
export async function resizeImage(
  input: Buffer,
  presets: readonly ImagePreset[],
  options: ResizeOptions,
): Promise<ResizeResult> {
  const meta = await traced(
    'sharp metadata',
    { attributes: { 'image.input.bytes': input.length } },
    async (span) => {
      let meta: sharp.Metadata;
      try {
        meta = await sharp(input).metadata();
      } catch (err) {
        throw new PermanentError(`unreadable image: ${(err as Error).message}`);
      }
      span.setAttributes({
        'image.format': meta.format,
        'image.width': meta.width,
        'image.height': meta.height,
      });
      return meta;
    },
  );
  if (!meta.width || !meta.height) throw new PermanentError('image has no dimensions');
  if (meta.width * meta.height > options.maxInputPixels) {
    throw new PermanentError(
      `image is ${meta.width}x${meta.height}, over the ${options.maxInputPixels} pixel limit`,
    );
  }

  const base = sharp(input, { failOn: 'error', limitInputPixels: options.maxInputPixels }).rotate();
  const images = await Promise.all(
    presets.map((preset) =>
      traced('sharp resize', { attributes: { 'image.preset': preset } }, async (span) => {
        const { data, info } = await base
          .clone()
          .resize({ width: IMAGE_PRESETS[preset], withoutEnlargement: true })
          .webp({ quality: options.quality ?? 80 })
          .toBuffer({ resolveWithObject: true });
        span.setAttributes({
          'image.width': info.width,
          'image.height': info.height,
          'image.output.bytes': data.length,
        });
        return { preset, width: info.width, height: info.height, data };
      }),
    ),
  );
  return { source: { width: meta.autoOrient.width, height: meta.autoOrient.height }, images };
}
