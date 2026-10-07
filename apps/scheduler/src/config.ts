import { baseEnvSchema, natsEnvSchema } from '@pdp/config';
import { type z } from 'zod';

export const envSchema = baseEnvSchema.extend(natsEnvSchema.shape);
export type Env = z.infer<typeof envSchema>;
