import {
  baseEnvSchema,
  egressEnvSchema,
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
  ...egressEnvSchema.shape,
  MAX_VIDEO_UPLOAD_BYTES: positiveInt().default(100 * 1024 * 1024),
  /**
   * Host the client sees; presigned URLs are signed for it, not for the in-cluster endpoint.
   * Unset, they point where the gateway itself goes: `S3_ENDPOINT` or AWS S3 of `S3_REGION`.
   */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  /** For the one call a request waits on, the SDK's retries included. */
  S3_TIMEOUT_MS: positiveInt().default(3000),
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

  /** Sliding: every request with the session extends it by this much. */
  SESSION_IDLE_TTL_S: positiveInt().default(7 * 24 * 3600),
  /** Absolute: after this the user logs in again, however active. Also the cookie's Max-Age. */
  SESSION_MAX_AGE_S: positiveInt().default(30 * 24 * 3600),
  /** Browsers accept `Secure` cookies from http://localhost and *.localhost, so dev keeps it on. */
  SESSION_COOKIE_SECURE: z.stringbool().default(true),
  /**
   * Origins of the Web UI, comma-separated. Requests that change data with a session must
   * come from one of them; login and register refuse any other Origin (ADR-013).
   */
  APP_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:18090')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  /** Login and register per client IP, and login per email; failed or not. */
  AUTH_IP_RATE_PER_MIN: positiveInt().default(10),
  AUTH_IP_BURST: positiveInt().default(20),
  AUTH_EMAIL_RATE_PER_MIN: positiveInt().default(1),
  AUTH_EMAIL_BURST: positiveInt().default(5),

  QUEUE_DEPTH_CACHE_MS: positiveInt().default(1000),
  BACKPRESSURE_MAX_DEPTH_CPU: positiveInt().default(2000),
  BACKPRESSURE_MAX_DEPTH_IO: positiveInt().default(2000),
  BACKPRESSURE_MAX_DEPTH_PRIORITY: positiveInt().default(500),
  BACKPRESSURE_RETRY_AFTER_S: positiveInt().default(5),
});
export type Env = z.infer<typeof envSchema>;
