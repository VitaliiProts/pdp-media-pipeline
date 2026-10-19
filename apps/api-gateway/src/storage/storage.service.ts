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
import { s3Connection } from '@pdp/config';
import { type Env } from '../config';

/** Polling clients get the same GET links for this long, so browsers reuse what they cached. */
export const PRESIGN_BUCKET_S = 300;

@Injectable()
export class StorageService implements OnApplicationShutdown {
  readonly bucket: string;
  /** Talks to S3 from inside the network. */
  private readonly internal: S3Client;
  /** Only signs URLs; never sends requests itself. */
  private readonly signer: S3Client;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    const connection = s3Connection(config);
    this.internal = new S3Client(connection);
    this.signer = new S3Client({
      ...connection,
      endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? connection.endpoint,
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

  /**
   * With `downloadName`, browsers save the file under that name instead of opening it.
   * Signed as of the start of the current `PRESIGN_BUCKET_S` bucket, so the link stays valid
   * for at least `expiresIn` seconds and repeats until the bucket ends.
   */
  presignGet(
    key: string,
    expiresIn: number,
    { downloadName }: { downloadName?: string } = {},
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(downloadName !== undefined && {
        ResponseContentDisposition: `attachment; filename*=UTF-8''${rfc5987(downloadName)}`,
      }),
    });
    const bucketMs = PRESIGN_BUCKET_S * 1000;
    return getSignedUrl(this.signer, command, {
      signingDate: new Date(Math.floor(Date.now() / bucketMs) * bucketMs),
      expiresIn: expiresIn + PRESIGN_BUCKET_S,
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

/** `encodeURIComponent` leaves `'()*` as they are, which the header grammar does not allow. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
