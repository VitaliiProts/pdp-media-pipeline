import { z } from 'zod';

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const postgresEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export const natsEnvSchema = z.object({
  NATS_URL: z.string().min(1),
});

/** Without an endpoint and keys the SDK goes to AWS with the pod's role; see `s3Connection`. */
export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(3),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
});

export const metadataClientEnvSchema = z.object({
  METADATA_URL: z.url(),
  METADATA_TIMEOUT_MS: z.coerce.number().int().min(100).default(2000),
});

export const uploadLimitsEnvSchema = z.object({
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(20 * 1024 * 1024),
});

/** Outbound requests to user-supplied URLs (job sources, webhooks). */
export const egressEnvSchema = z.object({
  EGRESS_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  EGRESS_PER_HOST_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  /** Comma-separated host names allowed to resolve to private addresses, e.g. a test receiver. */
  EGRESS_PRIVATE_HOSTS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    ),
});

/**
 * How long a stopping worker lets running jobs finish before it aborts them and hands them
 * back. Stopping takes up to this plus 5 s for the aborted jobs to report, so keep the pod's
 * `terminationGracePeriodSeconds` at least 10 s above it.
 */
export const workerShutdownEnvSchema = z.object({
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(20_000),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
