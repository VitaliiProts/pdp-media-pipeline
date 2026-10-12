import { z } from 'zod';
import { EXACTLY_ONE_SOURCE_MESSAGE, hasExactlyOneSource, mediaSourceFields } from './source';

/** Target width in px; height keeps the aspect ratio. */
export const IMAGE_PRESETS = {
  thumb: 200,
  medium: 800,
  large: 1600,
} as const;

export const IMAGE_PRESET_NAMES = Object.keys(IMAGE_PRESETS) as [keyof typeof IMAGE_PRESETS];
export const ImagePresetSchema = z.enum(IMAGE_PRESET_NAMES);
export type ImagePreset = z.infer<typeof ImagePresetSchema>;

export const ImageResizeInputV1 = z
  .object({
    ...mediaSourceFields,
    presets: z
      .array(ImagePresetSchema)
      .min(1)
      .refine((p) => new Set(p).size === p.length, 'presets must be unique'),
  })
  .refine(hasExactlyOneSource, EXACTLY_ONE_SOURCE_MESSAGE);
export type ImageResizeInputV1 = z.infer<typeof ImageResizeInputV1>;

export const ImageResultSchema = z.object({
  preset: ImagePresetSchema,
  key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});
export type ImageResult = z.infer<typeof ImageResultSchema>;

export const ImageResizeOutputV1 = z.object({
  results: z.array(ImageResultSchema),
});
export type ImageResizeOutputV1 = z.infer<typeof ImageResizeOutputV1>;

/** Deterministic, so a redelivered job overwrites instead of duplicating. */
export const imageResultKey = (jobId: string, preset: ImagePreset): string =>
  `results/${jobId}/${preset}.webp`;

export const uploadKeyPrefix = (userId: string): string => `uploads/${userId}/`;
