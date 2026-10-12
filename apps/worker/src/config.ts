import {
  baseEnvSchema,
  metadataClientEnvSchema,
  natsEnvSchema,
  s3EnvSchema,
  uploadLimitsEnvSchema,
} from '@pdp/config';
import os from 'node:os';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...natsEnvSchema.shape,
  ...s3EnvSchema.shape,
  ...metadataClientEnvSchema.shape,
  ...uploadLimitsEnvSchema.shape,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(os.availableParallelism()),
  WORKER_ID: z.string().min(1).default(os.hostname()),
  MAX_INPUT_PIXELS: z.coerce.number().int().min(1).default(50_000_000),
  WORKER_ACK_WAIT_MS: z.coerce.number().int().min(1000).default(30_000),
  /**
   * `max_ack_pending` of the shared durable consumer: unacked messages across all
   * replicas, not per process. Keep it at least max replicas × WORKER_CONCURRENCY,
   * or extra replicas sit idle. Per-process load is capped by the semaphore.
   */
  WORKER_MAX_ACK_PENDING: z.coerce.number().int().min(1).default(256),
  /** Full-jitter backoff between attempts: random(0, min(max, base × 2^(n−1))). */
  WORKER_RETRY_BASE_MS: z.coerce.number().int().min(0).default(1000),
  WORKER_RETRY_MAX_MS: z.coerce.number().int().min(0).default(60_000),
});
export type Env = z.infer<typeof envSchema>;
