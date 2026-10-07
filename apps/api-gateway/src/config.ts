import { baseEnvSchema, natsEnvSchema, redisEnvSchema } from '@pdp/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...redisEnvSchema.shape,
  ...natsEnvSchema.shape,
  METADATA_URL: z.url(),
});
export type Env = z.infer<typeof envSchema>;
