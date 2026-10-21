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

  const SOURCES = {
    'image.resize': { name: 'a.png', contentType: 'image/png' },
    'video.frames': { name: 'a.mp4', contentType: 'video/mp4' },
  } as const;
  type SourceType = keyof typeof SOURCES;
  const inputOf = (type: SourceType, sourceKey: string) =>
    type === 'image.resize'
      ? { sourceKey, presets: ['thumb'] }
      : { sourceKey, intervalSeconds: 2, maxFrames: 10 };

  const anUploaded = async (type: SourceType) => {
    const state = await aUser();
    const { name, contentType } = SOURCES[type];
    const sourceKey = `uploads/${state.userId}/${name}`;
    const { id } = await client.createAsset({
      userId: state.userId,
      key: sourceKey,
      contentType,
      size: 1024,
      name,
    });
    return { ...state, sourceKey, assetId: id };
  };
  const anUploadedImage = () => anUploaded('image.resize');

  const aQueuedJob = async (type: SourceType, idempotency?: typeof IDEMPOTENCY) => {
    const state = await anUploaded(type);
    const { job } = await client.createJob({
      userId: state.userId,
      type,
      priority: 5,
      input: inputOf(type, state.sourceKey),
      idempotency,
    });
    return { ...state, jobId: job.id };
  };
  const aQueuedImageJob = (idempotency?: typeof IDEMPOTENCY) =>
    aQueuedJob('image.resize', idempotency);

  const actor = 'worker:pact';
  const aScheduledJob = async (type: SourceType) => {
    const state = await aQueuedJob(type);
    await client.transition(state.jobId, { to: 'scheduled', attempt: 0, actor, class: 'cpu' });
    return state;
  };
  const aRunningJob = async (type: SourceType) => {
    const state = await aScheduledJob(type);
    await client.transition(state.jobId, { to: 'running', attempt: 1, actor });
    return state;
  };

  /** The states `JobRunner` contracts start from, for every job type a worker runs. */
  const runnerStates = (type: SourceType) => ({
    [`a scheduled ${type} job`]: () => aScheduledJob(type),
    [`a ${type} job running its first attempt`]: () => aRunningJob(type),
    [`a succeeded ${type} job`]: async () => {
      const state = await aRunningJob(type);
      await client.transition(state.jobId, { to: 'succeeded', attempt: 1, actor, output: {} });
      return state;
    },
    [`a ${type} job running its second attempt`]: async () => {
      const state = await aRunningJob(type);
      await client.transition(state.jobId, { to: 'scheduled', attempt: 1, actor, error: 'lost' });
      await client.transition(state.jobId, { to: 'running', attempt: 2, actor });
      return state;
    },
  });

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
          const state = await aRunningJob('image.resize');
          await client.transition(state.jobId, { to: 'dead', attempt: 1, actor, error: 'broken' });
          return state;
        },
        ...runnerStates('image.resize'),
        ...runnerStates('video.frames'),
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
