import { Verifier } from '@pact-foundation/pact';
import { type MetadataClient } from '@pdp/metadata-client';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { type Pool } from 'pg';
import { seedUser } from '../../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from '../support/apps';
import { prepareDatabase } from '../support/helpers';
import { type Infra, startInfra } from '../support/infra';
import { API_KEY, CREDENTIALS, IDEMPOTENCY, metadataAt, PACTS_DIR } from './support/pact';

/** Every consumer's contract with Metadata, as committed. */
const pactsOf = (provider: string) =>
  readdirSync(PACTS_DIR)
    .filter((file) => file.endsWith(`-${provider}.json`))
    .map((file) => path.join(PACTS_DIR, file));

describe('metadata honours the contracts of its consumers', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let url: string;
  let client: MetadataClient;

  beforeAll(async () => {
    infra = await startInfra();
    ({ pool } = await prepareDatabase(infra));
    apps = createApps(infra);
    url = await apps.start('metadata');
    client = metadataAt(url);
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  const aUser = async (options: { apiKey?: string } = {}) => {
    const { userId } = await seedUser(infra.databaseUrl, 'Pact', options);
    return { userId, sourceKey: `uploads/${userId}/a.png` };
  };

  const anUploadedImage = async () => {
    const state = await aUser();
    const { id } = await client.createAsset({
      userId: state.userId,
      key: state.sourceKey,
      contentType: 'image/png',
      size: 1024,
      name: 'a.png',
    });
    return { ...state, assetId: id };
  };

  const aQueuedImageJob = async (idempotency?: typeof IDEMPOTENCY) => {
    const state = await anUploadedImage();
    const { job } = await client.createJob({
      userId: state.userId,
      type: 'image.resize',
      priority: 5,
      input: { sourceKey: state.sourceKey, presets: ['thumb'] },
      idempotency,
    });
    return { ...state, jobId: job.id };
  };

  it('verifies every interaction', async () => {
    await new Verifier({
      provider: 'metadata',
      providerBaseUrl: url,
      pactUrls: pactsOf('metadata'),
      logLevel: 'warn',
      beforeEach: async () => {
        await pool.query(`DO $$ BEGIN
          EXECUTE (SELECT 'TRUNCATE ' || string_agg(format('%I', tablename), ', ') || ' CASCADE'
                   FROM pg_tables WHERE schemaname = 'public');
        END $$`);
      },
      stateHandlers: {
        'a user': () => aUser(),
        // DUB_SYSTEM_QUOTA_SECONDS is not set for the app under test.
        'a user, with no system-wide dub limit': () => aUser(),
        'a user with an uploaded image': anUploadedImage,
        'a queued image job': () => aQueuedImageJob(),
        'a job created with an idempotency key': () => aQueuedImageJob(IDEMPOTENCY),
        'a dead image job': async () => {
          const state = await aQueuedImageJob();
          const actor = 'worker:pact';
          await client.transition(state.jobId, {
            to: 'scheduled',
            attempt: 0,
            actor,
            class: 'cpu',
          });
          await client.transition(state.jobId, { to: 'running', attempt: 1, actor });
          await client.transition(state.jobId, { to: 'dead', attempt: 1, actor, error: 'broken' });
          return state;
        },
        'a user with a webhook endpoint': async () => {
          const state = await aUser();
          const { id } = await client.createWebhookEndpoint({
            userId: state.userId,
            url: 'https://example.com/hooks',
            events: ['job.succeeded', 'job.dead'],
          });
          return { ...state, endpointId: id };
        },
        'a user who signs in with an email and password': async () => {
          const { id } = await client.register({ ...CREDENTIALS, name: 'Pact' });
          return { userId: id };
        },
        'a user with a second API key': async () => {
          const state = await aUser();
          const { id } = await client.createApiKey({ userId: state.userId, name: 'ci' });
          return { ...state, apiKeyId: id };
        },
        'a user with a known API key': () => aUser({ apiKey: API_KEY }),
      },
    }).verifyProvider();
  });
});
