import { baseEnvSchema, natsEnvSchema, postgresEnvSchema } from '@pdp/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...postgresEnvSchema.shape,
  ...natsEnvSchema.shape,
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  OUTBOX_POLL_MS: z.coerce.number().int().min(10).default(200),
  OUTBOX_BATCH: z.coerce.number().int().min(1).max(1000).default(100),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).default(24),
});
export type Env = z.infer<typeof envSchema>;
