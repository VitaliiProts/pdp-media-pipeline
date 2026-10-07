import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';

export const BUCKET = 'spike';
export const STREAM = 'SPIKE_JOBS';
export const SUBJECT = 'spike.resize';
export const DURABLE = 'resize-worker';

export const PRESETS = { thumb: 200, medium: 800, large: 1600 };

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
});

export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
}

/** imageUrl format: s3://<bucket>/<key> */
export async function downloadImage(imageUrl) {
  const { hostname: Bucket, pathname } = new URL(imageUrl);
  const res = await s3.send(new GetObjectCommand({ Bucket, Key: pathname.slice(1) }));
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function resizeAndUpload(jobId, imageUrl, preset) {
  const width = PRESETS[preset];
  if (!width) throw new Error(`unknown preset ${preset}`);
  const input = await downloadImage(imageUrl);
  const output = await sharp(input).resize({ width, withoutEnlargement: true }).webp().toBuffer();
  const Key = `results/${jobId}/${preset}.webp`;
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key, Body: output, ContentType: 'image/webp' }),
  );
  return Key;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ts = () => new Date().toISOString().slice(11, 23);
export const log = (who, ...args) => console.log(`[${ts()}] [${who}]`, ...args);
