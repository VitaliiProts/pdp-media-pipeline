import {
  baseEnvSchema,
  egressEnvSchema,
  metadataClientEnvSchema,
  natsEnvSchema,
  s3EnvSchema,
} from '@pdp/config';
import { VIDEO_MAX_DURATION_SECONDS } from '@pdp/contracts';
import os from 'node:os';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...natsEnvSchema.shape,
  ...s3EnvSchema.shape,
  ...metadataClientEnvSchema.shape,
  ...egressEnvSchema.shape,
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
  /** Scratch space for downloads and frames; defaults to the OS temp dir. */
  VIDEO_WORK_DIR: z.string().optional(),
});
export type Env = z.infer<typeof envSchema>;
