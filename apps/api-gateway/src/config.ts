import {
  baseEnvSchema,
  metadataClientEnvSchema,
  natsEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
  uploadLimitsEnvSchema,
} from '@pdp/config';
import { z } from 'zod';

const positiveInt = () => z.coerce.number().int().min(1);

export const envSchema = baseEnvSchema.extend({
  ...redisEnvSchema.shape,
  ...natsEnvSchema.shape,
  ...s3EnvSchema.shape,
  ...metadataClientEnvSchema.shape,
  ...uploadLimitsEnvSchema.shape,
  /** Host the client sees; presigned URLs are signed for it, not for the in-cluster endpoint. */
  S3_PUBLIC_ENDPOINT: z.url(),
  API_KEY_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
  /** Proxies in front of the gateway whose X-Forwarded-For is trusted for the client IP. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  REDIS_COMMAND_TIMEOUT_MS: positiveInt().default(100),
  RATE_LIMIT_USER_RPS: positiveInt().default(20),
  RATE_LIMIT_USER_BURST: positiveInt().default(20),
  RATE_LIMIT_GLOBAL_RPS: positiveInt().default(200),
  RATE_LIMIT_GLOBAL_BURST: positiveInt().default(200),
  /** For unknown API keys only: each one costs a lookup in Metadata. */
  RATE_LIMIT_IP_RPS: positiveInt().default(10),
  RATE_LIMIT_IP_BURST: positiveInt().default(20),
  /** The local fallback divides every limit by this, so N replicas together stay close to it. */
  RATE_LIMIT_REPLICAS: positiveInt().default(1),
  /** After a Redis failure, use the local limiter for this long before trying Redis again. */
  RATE_LIMIT_REDIS_RETRY_MS: positiveInt().default(1000),

  QUEUE_DEPTH_CACHE_MS: positiveInt().default(1000),
  BACKPRESSURE_MAX_DEPTH_CPU: positiveInt().default(2000),
  BACKPRESSURE_MAX_DEPTH_IO: positiveInt().default(2000),
  BACKPRESSURE_MAX_DEPTH_PRIORITY: positiveInt().default(500),
  BACKPRESSURE_RETRY_AFTER_S: positiveInt().default(5),
});
export type Env = z.infer<typeof envSchema>;
