import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env } from '../config';

@Injectable()
export class StorageService implements OnApplicationShutdown {
  readonly bucket: string;
  /** Talks to S3 from inside the network. */
  private readonly internal: S3Client;
  /** Only signs URLs; never sends requests itself. */
  private readonly signer: S3Client;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    const base = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    };
    this.internal = new S3Client({ ...base, endpoint: config.get('S3_ENDPOINT', { infer: true }) });
    this.signer = new S3Client({
      ...base,
      endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }),
    });
  }

  /**
   * `ContentLength` and `ContentType` are signed, so the client must send exactly
   * the size and type it declared.
   */
  presignPut(key: string, contentType: string, size: number, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn },
    );
  }

  presignGet(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    });
  }

  /** Returns the object size, or `null` when it does not exist. */
  async headObject(key: string): Promise<{ size: number } | null> {
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: head.ContentLength ?? 0 };
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async ping(): Promise<void> {
    await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onApplicationShutdown(): void {
    this.internal.destroy();
    this.signer.destroy();
  }
}
