import { baseEnvSchema, postgresEnvSchema } from '@pdp/config';
import { type z } from 'zod';

export const envSchema = baseEnvSchema.extend(postgresEnvSchema.shape);
export type Env = z.infer<typeof envSchema>;
