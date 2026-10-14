import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type s3EnvSchema } from '@pdp/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type z } from 'zod';
import { PermanentError } from './permanent-error';

export interface ObjectStorageOptions {
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** A missing or oversized object is permanent; any other failure is worth a retry. */
export class ObjectStorage implements OnApplicationShutdown {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(options: ObjectStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async getObject(key: string, maxBytes: number): Promise<Buffer> {
    const res = await this.open(key, maxBytes);
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  /** Streams to disk, for inputs too large to hold in memory comfortably. */
  async downloadToFile(key: string, path: string, maxBytes: number): Promise<number> {
    const res = await this.open(key, maxBytes);
    if (!(res.Body instanceof Readable)) throw new Error(`empty body for ${key}`);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new PermanentError(`source is over ${maxBytes} bytes`));
        else callback(null, chunk);
      },
    });
    await pipeline(res.Body, counter, createWriteStream(path));
    return bytes;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Streams from disk; a transcoded video is too large to read into memory first. */
  async uploadFile(key: string, path: string, contentType: string): Promise<number> {
    const { size } = await stat(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
    return size;
  }

  /** Succeeds for a key that is already gone, so a repeated purge is harmless. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Deletes everything under `prefix`, a page of up to 1000 keys at a time; returns how many. */
  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        const res = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        const failed = res.Errors ?? [];
        if (failed.length > 0) {
          throw new Error(
            `could not delete ${failed.length} objects under ${prefix}: ${failed[0]?.Message}`,
          );
        }
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  /** Fails when the storage is unreachable or the bucket does not exist. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  private async open(key: string, maxBytes: number): Promise<GetObjectCommandOutput> {
    let res: GetObjectCommandOutput;
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
    return res;
  }
}

type S3Env = z.infer<typeof s3EnvSchema>;

const objectStorageProvider: Provider = {
  provide: ObjectStorage,
  inject: [ConfigService],
  useFactory: (config: ConfigService<S3Env, true>) =>
    new ObjectStorage({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      bucket: config.get('S3_BUCKET', { infer: true }),
    }),
};

/** Reads `S3_*` from the global ConfigModule. */
@Module({ providers: [objectStorageProvider], exports: [ObjectStorage] })
export class ObjectStorageModule {}
