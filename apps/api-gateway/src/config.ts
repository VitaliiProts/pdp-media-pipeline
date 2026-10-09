import {
  baseEnvSchema,
  metadataClientEnvSchema,
  natsEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
  uploadLimitsEnvSchema,
} from '@pdp/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...redisEnvSchema.shape,
  ...natsEnvSchema.shape,
  ...s3EnvSchema.shape,
  ...metadataClientEnvSchema.shape,
  ...uploadLimitsEnvSchema.shape,
  /** Host the client sees; presigned URLs are signed for it, not for the in-cluster endpoint. */
  S3_PUBLIC_ENDPOINT: z.url(),
  API_KEY_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
});
export type Env = z.infer<typeof envSchema>;
