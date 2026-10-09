import {
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env } from '../config';
import { PermanentError } from '../image/permanent-error';

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

  /** A missing or oversized object is permanent; any other failure is worth a retry. */
  async getObject(key: string, maxBytes: number): Promise<Buffer> {
    let res;
    try {
      res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (err instanceof NoSuchKey) throw new PermanentError(`source ${key} not found`);
      throw err;
    }
    if ((res.ContentLength ?? 0) > maxBytes) {
      res.Body?.transformToWebStream()
        .cancel()
        .catch(() => undefined);
      throw new PermanentError(`source is ${res.ContentLength} bytes, over ${maxBytes}`);
    }
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Fails when the storage is unreachable or the bucket does not exist. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
