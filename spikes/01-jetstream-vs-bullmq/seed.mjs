import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { BUCKET, ensureBucket, log, s3 } from './common.mjs';

await ensureBucket();

const image = await sharp({
  create: { width: 3000, height: 2000, channels: 3, background: { r: 40, g: 120, b: 200 } },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="3000" height="2000"><circle cx="1500" cy="1000" r="800" fill="orange"/></svg>`,
      ),
    },
  ])
  .jpeg()
  .toBuffer();

await s3.send(
  new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'sources/test.jpg',
    Body: image,
    ContentType: 'image/jpeg',
  }),
);
log('seed', `uploaded s3://${BUCKET}/sources/test.jpg (${image.length} bytes)`);
