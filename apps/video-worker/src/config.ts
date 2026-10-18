import {
  baseEnvSchema,
  egressEnvSchema,
  metadataClientEnvSchema,
  natsEnvSchema,
  s3EnvSchema,
  workerShutdownEnvSchema,
} from '@pdp/config';
import {
  DUB_MAX_DURATION_SECONDS,
  TRANSCODE_MAX_DURATION_SECONDS,
  VIDEO_MAX_DURATION_SECONDS,
} from '@pdp/contracts';
import os from 'node:os';
import { z } from 'zod';
import { dubEnvSchema } from './dub/dub-providers';

export const VIDEO_JOB_TYPES = ['video.frames', 'video.transcode', 'video.dub'] as const;
export type VideoJobType = (typeof VIDEO_JOB_TYPES)[number];
/** `video.dub` needs a key and a model, so it runs only where it is asked for. */
const DEFAULT_VIDEO_JOB_TYPES: readonly VideoJobType[] = ['video.frames', 'video.transcode'];

export const envSchema = baseEnvSchema.extend({
  ...natsEnvSchema.shape,
  ...s3EnvSchema.shape,
  ...metadataClientEnvSchema.shape,
  ...egressEnvSchema.shape,
  ...workerShutdownEnvSchema.shape,
  ...dubEnvSchema.shape,
  /** ffmpeg uses several threads per run, so one or two videos at a time per core group. */
  VIDEO_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  WORKER_ID: z.string().min(1).default(os.hostname()),
  WORKER_ACK_WAIT_MS: z.coerce.number().int().min(1000).default(30_000),
  WORKER_MAX_ACK_PENDING: z.coerce.number().int().min(1).default(64),
  WORKER_RETRY_BASE_MS: z.coerce.number().int().min(0).default(1000),
  WORKER_RETRY_MAX_MS: z.coerce.number().int().min(0).default(60_000),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  /** Per ffmpeg / ffprobe run; the process is SIGKILLed after it. */
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().min(100).default(120_000),
  MAX_VIDEO_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(100 * 1024 * 1024),
  VIDEO_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(100).default(60_000),
  VIDEO_MAX_DURATION_SECONDS: z.coerce
    .number()
    .positive()
    .max(VIDEO_MAX_DURATION_SECONDS)
    .default(VIDEO_MAX_DURATION_SECONDS),
  VIDEO_MAX_DIMENSION: z.coerce.number().int().min(16).default(8192),
  /**
   * Which job types this instance consumes, comma-separated. Frames and transcoding share
   * the image but run as separate deployments, so a long transcode never holds the slot a
   * frames job waits for.
   */
  VIDEO_JOB_TYPES: z
    .string()
    .default(DEFAULT_VIDEO_JOB_TYPES.join(','))
    .transform((s) => s.split(',').map((t) => t.trim()))
    .pipe(
      z
        .array(z.enum(VIDEO_JOB_TYPES))
        .min(1)
        .refine((t) => new Set(t).size === t.length, 'job types must be unique'),
    ),
  /** For the whole ffmpeg run of `video.transcode`; it is SIGKILLed after it. */
  TRANSCODE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(600_000),
  TRANSCODE_MAX_DURATION_SECONDS: z.coerce
    .number()
    .positive()
    .max(TRANSCODE_MAX_DURATION_SECONDS)
    .default(TRANSCODE_MAX_DURATION_SECONDS),
  DUB_MAX_DURATION_SECONDS: z.coerce
    .number()
    .positive()
    .max(DUB_MAX_DURATION_SECONDS)
    .default(DUB_MAX_DURATION_SECONDS),
  /** Minimum time between two progress updates of one job. */
  JOB_PROGRESS_INTERVAL_MS: z.coerce.number().int().min(100).default(3000),
  /** Scratch space for downloads and frames; defaults to the OS temp dir. */
  VIDEO_WORK_DIR: z.string().optional(),
});
export type Env = z.infer<typeof envSchema>;
