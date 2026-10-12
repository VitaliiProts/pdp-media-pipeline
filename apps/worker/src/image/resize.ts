import { IMAGE_PRESETS, type ImagePreset } from '@pdp/contracts';
import sharp from 'sharp';
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

/**
 * Validates the header before decoding: unreadable or oversized input is a
 * permanent failure, while errors during the resize itself may be retried.
 */
export async function resizeImage(
  input: Buffer,
  presets: readonly ImagePreset[],
  options: ResizeOptions,
): Promise<ResizedImage[]> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch (err) {
    throw new PermanentError(`unreadable image: ${(err as Error).message}`);
  }
  if (!meta.width || !meta.height) throw new PermanentError('image has no dimensions');
  if (meta.width * meta.height > options.maxInputPixels) {
    throw new PermanentError(
      `image is ${meta.width}x${meta.height}, over the ${options.maxInputPixels} pixel limit`,
    );
  }

  const base = sharp(input, { failOn: 'error', limitInputPixels: options.maxInputPixels }).rotate();
  return Promise.all(
    presets.map(async (preset) => {
      const { data, info } = await base
        .clone()
        .resize({ width: IMAGE_PRESETS[preset], withoutEnlargement: true })
        .webp({ quality: options.quality ?? 80 })
        .toBuffer({ resolveWithObject: true });
      return { preset, width: info.width, height: info.height, data };
    }),
  );
}
