import { z } from 'zod';
import { EXACTLY_ONE_SOURCE_MESSAGE, hasExactlyOneSource, mediaSourceFields } from './source';

export const VIDEO_MAX_DURATION_SECONDS = 60;
/** Frames are scaled down to this width; smaller videos keep their size. */
export const VIDEO_FRAME_WIDTH = 640;
export const VIDEO_CODECS = ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4'] as const;

export const VideoFramesInputV1 = z
  .object({
    ...mediaSourceFields,
    intervalSeconds: z.number().min(0.5).max(30).default(2),
    maxFrames: z.number().int().min(1).max(60).default(10),
  })
  .refine(hasExactlyOneSource, EXACTLY_ONE_SOURCE_MESSAGE);
export type VideoFramesInputV1 = z.infer<typeof VideoFramesInputV1>;

export const VideoFrameSchema = z.object({
  key: z.string(),
  atSeconds: z.number().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});
export type VideoFrame = z.infer<typeof VideoFrameSchema>;

export const VideoFramesOutputV1 = z.object({
  durationSeconds: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z.enum(VIDEO_CODECS),
  preview: VideoFrameSchema,
  frames: z.array(VideoFrameSchema),
});
export type VideoFramesOutputV1 = z.infer<typeof VideoFramesOutputV1>;

/** Deterministic, so a redelivered job overwrites instead of duplicating. */
export const videoPreviewKey = (jobId: string): string => `results/${jobId}/preview.jpg`;

export const videoFrameKey = (jobId: string, index: number): string =>
  `results/${jobId}/frames/${String(index + 1).padStart(4, '0')}.jpg`;
