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
});
export type Env = z.infer<typeof envSchema>;
