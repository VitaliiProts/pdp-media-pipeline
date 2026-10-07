import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env } from '../config';

@Injectable()
export class StorageService implements OnApplicationShutdown {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    });
  }

  /** Fails when the storage is unreachable or the bucket does not exist. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
