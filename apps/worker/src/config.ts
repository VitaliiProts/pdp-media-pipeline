import { baseEnvSchema, natsEnvSchema, s3EnvSchema } from '@pdp/config';
import { type z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...natsEnvSchema.shape,
  ...s3EnvSchema.shape,
});
export type Env = z.infer<typeof envSchema>;
