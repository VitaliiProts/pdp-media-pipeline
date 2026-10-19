import { type ConfigService } from '@nestjs/config';
import { type z } from 'zod';
import { type s3EnvSchema } from './schemas';

export type S3Env = z.infer<typeof s3EnvSchema>;

/** Fits `S3ClientConfig` of `@aws-sdk/client-s3`. */
export interface S3Connection {
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
  /** Absent in AWS: the SDK's default chain picks up the pod's role (EKS Pod Identity). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function s3Connection(config: ConfigService<S3Env, true>): S3Connection {
  const accessKeyId = config.get('S3_ACCESS_KEY', { infer: true });
  const secretAccessKey = config.get('S3_SECRET_KEY', { infer: true });
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
    throw new Error('S3_ACCESS_KEY and S3_SECRET_KEY are set together or not at all');
  }
  return {
    endpoint: config.get('S3_ENDPOINT', { infer: true }),
    region: config.get('S3_REGION', { infer: true }),
    forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    credentials:
      accessKeyId !== undefined && secretAccessKey !== undefined
        ? { accessKeyId, secretAccessKey }
        : undefined,
  };
}
