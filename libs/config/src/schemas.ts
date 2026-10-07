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

export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
