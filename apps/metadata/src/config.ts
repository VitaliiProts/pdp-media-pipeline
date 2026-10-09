import { baseEnvSchema, natsEnvSchema, postgresEnvSchema } from '@pdp/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...postgresEnvSchema.shape,
  ...natsEnvSchema.shape,
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  OUTBOX_POLL_MS: z.coerce.number().int().min(10).default(200),
  OUTBOX_BATCH: z.coerce.number().int().min(1).max(1000).default(100),
});
export type Env = z.infer<typeof envSchema>;
