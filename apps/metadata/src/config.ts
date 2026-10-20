import { baseEnvSchema, natsEnvSchema, postgresEnvSchema } from '@pdp/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  ...postgresEnvSchema.shape,
  ...natsEnvSchema.shape,
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  OUTBOX_POLL_MS: z.coerce.number().int().min(10).default(200),
  OUTBOX_BATCH: z.coerce.number().int().min(1).max(1000).default(100),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  /** Sum of live originals per user; checked when an upload reserves space. */
  STORAGE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(5 * 1024 ** 3),
  /** An upload that no job has used for this long is deleted like any other asset. */
  ASSET_UNUSED_TTL_S: z.coerce
    .number()
    .int()
    .min(60)
    .default(24 * 3600),
  ASSET_JANITOR_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .default(10 * 60_000),
  /** Seconds of video a user may dub per calendar month (UTC); each one is paid to providers. */
  DUB_QUOTA_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .default(30 * 60),
  /** The same, summed over all users: open registration must not multiply the bill. 0 = none. */
  DUB_SYSTEM_QUOTA_SECONDS: z.coerce.number().int().min(0).default(0),
});
export type Env = z.infer<typeof envSchema>;
