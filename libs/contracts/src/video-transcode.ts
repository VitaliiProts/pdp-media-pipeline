import { z } from 'zod';
import { EXACTLY_ONE_SOURCE_MESSAGE, hasExactlyOneSource, mediaSourceFields } from './source';
import { VIDEO_CODECS, VideoFrameSchema } from './video-frames';

/** Longer than for frames: transcoding is the type that is expected to take minutes. */
export const TRANSCODE_MAX_DURATION_SECONDS = 300;

/** Size of the shorter side, so a portrait video gets the same quality as a landscape one. */
export const RENDITIONS = {
  '480p': 480,
  '720p': 720,
} as const;

export const RENDITION_NAMES = Object.keys(RENDITIONS) as [keyof typeof RENDITIONS];
export const RenditionSchema = z.enum(RENDITION_NAMES);
export type Rendition = z.infer<typeof RenditionSchema>;

export const VideoTranscodeInputV1 = z
  .object({
    ...mediaSourceFields,
    renditions: z
      .array(RenditionSchema)
      .min(1)
      .refine((r) => new Set(r).size === r.length, 'renditions must be unique')
      .default([...RENDITION_NAMES]),
  })
  .refine(hasExactlyOneSource, EXACTLY_ONE_SOURCE_MESSAGE);
export type VideoTranscodeInputV1 = z.infer<typeof VideoTranscodeInputV1>;

export const RenditionResultSchema = z.object({
  rendition: RenditionSchema,
  key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  bytes: z.number().int().positive(),
  /** Of the whole file, audio included, in bits per second. */
  bitrate: z.number().int().positive(),
});
export type RenditionResult = z.infer<typeof RenditionResultSchema>;

export const VideoTranscodeOutputV1 = z.object({
  durationSeconds: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z.enum(VIDEO_CODECS),
  preview: VideoFrameSchema,
  renditions: z.array(RenditionResultSchema).min(1),
  /** Requested but larger than the source; videos are never upscaled. */
  skipped: z.array(RenditionSchema),
});
export type VideoTranscodeOutputV1 = z.infer<typeof VideoTranscodeOutputV1>;

/** Deterministic, so a redelivered job overwrites instead of duplicating. */
export const renditionKey = (jobId: string, rendition: Rendition): string =>
  `results/${jobId}/${rendition}.mp4`;
