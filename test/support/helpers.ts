import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { jetstream } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { Pool } from 'pg';
import sharp from 'sharp';
import { runMigrations } from '../../apps/metadata/src/migrate';
import { seedUser } from '../../apps/metadata/src/seed-user';
import { BUCKET, type Infra } from './infra';

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 30_000, intervalMs = 100, what = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function prepareDatabase(infra: Infra) {
  await runMigrations(infra.databaseUrl);
  const user = await seedUser(infra.databaseUrl, 'int-test');
  const pool = new Pool({ connectionString: infra.databaseUrl, max: 2 });
  return { user, pool };
}

export const pngImage = (width = 1200, height = 800) =>
  sharp({ create: { width, height, channels: 3, background: '#2a7ae2' } })
    .png()
    .toBuffer();

/**
 * What `POST /v1/uploads` records in Metadata, for tests that put objects into storage
 * directly: a job may only read an upload its user owns. The owner comes from the key.
 */
export async function registerUpload(pool: Pool, key: string, size = 1): Promise<string> {
  const userId = /^uploads\/([^/]+)\//.exec(key)?.[1];
  if (!userId) throw new Error(`${key} is not under uploads/{userId}/`);
  const video = /\.(mp4|webm|mov)$/.test(key);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assets (user_id, key, kind, content_type, size) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key RETURNING id`,
    [userId, key, video ? 'video' : 'image', video ? 'video/mp4' : 'image/png', size],
  );
  return rows[0]!.id;
}

export async function putSource(
  s3: S3Client,
  pool: Pool,
  key: string,
  body: Buffer,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/png' }),
  );
  await registerUpload(pool, key, body.length);
}

/** Reads everything currently stored for `subject` through an ephemeral ordered consumer. */
export async function readStream(
  natsUrl: string,
  stream: string,
  subject: string,
): Promise<unknown[]> {
  const nc = await connect({ servers: natsUrl });
  try {
    const consumer = await jetstream(nc).consumers.get(stream, { filter_subjects: [subject] });
    const messages: unknown[] = [];
    const batch = await consumer.fetch({ max_messages: 1000, expires: 1000 });
    for await (const msg of batch) messages.push(msg.json());
    return messages;
  } finally {
    await nc.close();
  }
}
