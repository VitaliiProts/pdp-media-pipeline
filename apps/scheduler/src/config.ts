import { baseEnvSchema, metadataClientEnvSchema, natsEnvSchema } from '@pdp/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...natsEnvSchema.shape,
  ...metadataClientEnvSchema.shape,
  SCHEDULER_CONCURRENCY: z.coerce.number().int().min(1).default(16),
});
export type Env = z.infer<typeof envSchema>;
