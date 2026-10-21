import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { MetadataClient } from '@pdp/metadata-client';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const { fromProviderState, integer, like, regex, uuid } = MatchersV3;

export const PACTS_DIR = path.resolve(__dirname, '../../../pacts');

/** Every consumer's contract with a provider, as committed. */
export const pactsOf = (provider: string): string[] =>
  readdirSync(PACTS_DIR)
    .filter((file) => file.endsWith(`-${provider}.json`))
    .map((file) => path.join(PACTS_DIR, file));

export const pactBetween = (consumer: string, provider: string) =>
  new PactV4({ consumer, provider, dir: PACTS_DIR, logLevel: 'warn' });

export const metadataAt = (url: string) => new MetadataClient({ baseUrl: url, timeoutMs: 2000 });

/**
 * Ids the consumer sends; at verification the provider state supplies the real ones under
 * the same names, e.g. `${jobId}`.
 */
export const EXAMPLE = {
  userId: '5d3c3a8e-0f43-4d5c-8b0e-6a1f2b3c4d5e',
  jobId: '7c1e0a52-6b1d-4a55-9d0a-2f3a0c1b9e11',
  assetId: '0b6f9c2e-3a41-4f7d-9e2b-8c5d1a7f3e20',
  endpointId: 'a2e4c6d8-1b3f-4a5c-8e7d-9f0a1b2c3d4e',
  apiKeyId: 'c9d8e7f6-5a4b-4c3d-9e2f-1a0b9c8d7e6f',
  sourceKey: 'uploads/5d3c3a8e-0f43-4d5c-8b0e-6a1f2b3c4d5e/a.png',
} as const;

/** What some provider states are named after: the provider sets them up with these values. */
export const CREDENTIALS = { email: 'pact@example.com', password: 'pact-password' } as const;
export const API_KEY = 'pdp_pact-consumer-test-key';
export const IDEMPOTENCY = { key: 'pact-key', requestHash: 'a'.repeat(64) } as const;

export const fromState = (name: keyof typeof EXAMPLE) =>
  fromProviderState(`\${${name}}`, EXAMPLE[name]);

export const pathFromState = (template: string, example: string) =>
  fromProviderState(template, example);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.source;
export const timestamp = regex(ISO, '2026-10-21T12:00:00.000Z');

export const errorBody = (code: string) => ({ code, message: like('explanation') });

/** A job as Metadata returns it; the fields that matter to a consumer are passed in. */
export const job = (fields: Record<string, unknown> = {}) => ({
  id: uuid(EXAMPLE.jobId),
  userId: uuid(EXAMPLE.userId),
  type: 'image.resize',
  class: null,
  status: 'queued',
  priority: integer(5),
  input: like({ sourceKey: EXAMPLE.sourceKey, presets: ['thumb'] }),
  output: null,
  attempts: integer(0),
  attemptBase: integer(0),
  deadReason: null,
  lastError: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  finishedAt: null,
  traceId: null,
  progress: null,
  progressStep: null,
  ...fields,
});

export const asset = (fields: Record<string, unknown> = {}) => ({
  id: uuid(EXAMPLE.assetId),
  userId: uuid(EXAMPLE.userId),
  key: like(EXAMPLE.sourceKey),
  kind: 'image',
  name: like('a.png'),
  contentType: 'image/png',
  size: integer(1024),
  width: null,
  height: null,
  durationSeconds: null,
  createdAt: timestamp,
  ...fields,
});

export const user = (fields: Record<string, unknown> = {}) => ({
  id: uuid(EXAMPLE.userId),
  name: like('Pact'),
  email: like('pact@example.com'),
  createdAt: timestamp,
  ...fields,
});

export const apiKey = (fields: Record<string, unknown> = {}) => ({
  id: uuid(EXAMPLE.apiKeyId),
  name: like('ci'),
  prefix: like('pdp_ab12'),
  createdAt: timestamp,
  lastUsedAt: null,
  ...fields,
});

export const webhookEndpoint = (fields: Record<string, unknown> = {}) => ({
  id: uuid(EXAMPLE.endpointId),
  userId: uuid(EXAMPLE.userId),
  url: like('https://example.com/hooks'),
  events: ['job.succeeded', 'job.dead'],
  createdAt: timestamp,
  ...fields,
});
