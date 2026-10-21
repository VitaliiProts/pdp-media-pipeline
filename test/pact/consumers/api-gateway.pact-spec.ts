import { MatchersV3 } from '@pact-foundation/pact';
import { hashApiKey, MEDIA_JOB_TYPES } from '@pdp/contracts';
import {
  API_KEY,
  apiKey,
  asset,
  CREDENTIALS,
  errorBody,
  EXAMPLE,
  fromState,
  IDEMPOTENCY,
  job,
  metadataAt,
  pactBetween,
  pathFromState,
  timestamp,
  user,
  webhookEndpoint,
} from '../support/pact';

const { eachLike, integer, like, uuid } = MatchersV3;

const pact = pactBetween('api-gateway', 'metadata');

const jobPath = pathFromState('/internal/jobs/${jobId}', `/internal/jobs/${EXAMPLE.jobId}`);
const assetPath = pathFromState(
  '/internal/assets/${assetId}',
  `/internal/assets/${EXAMPLE.assetId}`,
);
const userPath = (suffix = '') =>
  pathFromState(
    `/internal/users/\${userId}${suffix}`,
    `/internal/users/${EXAMPLE.userId}${suffix}`,
  );

const imageJobRequest = {
  userId: fromState('userId'),
  type: 'image.resize',
  priority: 5,
  input: { sourceKey: fromState('sourceKey'), presets: ['thumb'] },
  idempotency: IDEMPOTENCY,
};
const createImageJob = (url: string) =>
  metadataAt(url).createJob({
    userId: EXAMPLE.userId,
    type: 'image.resize',
    priority: 5,
    input: { sourceKey: EXAMPLE.sourceKey, presets: ['thumb'] },
    idempotency: IDEMPOTENCY,
  });

const rejects = (code: string): unknown => expect.objectContaining({ name: 'MetadataError', code });

describe('api-gateway → metadata', () => {
  describe('jobs', () => {
    it('creates a job', () =>
      pact
        .addInteraction()
        .given('a user with an uploaded image')
        .uponReceiving('a new job with an idempotency key')
        .withRequest('POST', '/internal/jobs', (b) => b.jsonBody(imageJobRequest))
        .willRespondWith(201, (b) => b.jsonBody({ job: job(), replayed: false }))
        .executeTest(async ({ url }) => {
          await expect(createImageJob(url)).resolves.toMatchObject({ replayed: false });
        }));

    it('replays a job created with the same idempotency key', () =>
      pact
        .addInteraction()
        .given('a job created with an idempotency key')
        .uponReceiving('a repeated job with the same idempotency key')
        .withRequest('POST', '/internal/jobs', (b) => b.jsonBody(imageJobRequest))
        .willRespondWith(200, (b) => b.jsonBody({ job: job(), replayed: true }))
        .executeTest(async ({ url }) => {
          await expect(createImageJob(url)).resolves.toMatchObject({ replayed: true });
        }));

    it('reads a job', () =>
      pact
        .addInteraction()
        .given('a queued image job')
        .uponReceiving('a request for a job')
        .withRequest('GET', jobPath)
        .willRespondWith(200, (b) => b.jsonBody(job()))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).getJob(EXAMPLE.jobId)).resolves.toMatchObject({
            status: 'queued',
          });
        }));

    it('reports an unknown job', () =>
      pact
        .addInteraction()
        .uponReceiving('a request for an unknown job')
        .withRequest('GET', `/internal/jobs/${EXAMPLE.jobId}`)
        .willRespondWith(404, (b) => b.jsonBody(errorBody('JOB_NOT_FOUND')))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).getJob(EXAMPLE.jobId)).rejects.toEqual(
            rejects('JOB_NOT_FOUND'),
          );
        }));

    it('lists the media jobs of a user', () =>
      pact
        .addInteraction()
        .given('a queued image job')
        .uponReceiving('a request for the media jobs of a user')
        .withRequest('GET', '/internal/jobs', (b) =>
          b.query({
            userId: fromState('userId'),
            status: 'queued',
            types: MEDIA_JOB_TYPES.join(','),
            limit: '20',
          }),
        )
        .willRespondWith(200, (b) => b.jsonBody({ items: eachLike(job()), nextCursor: null }))
        .executeTest(async ({ url }) => {
          const page = await metadataAt(url).listJobs({
            userId: EXAMPLE.userId,
            status: 'queued',
            types: [...MEDIA_JOB_TYPES],
            limit: 20,
          });
          expect(page.items).toHaveLength(1);
        }));

    it('lists the jobs of a file', () =>
      pact
        .addInteraction()
        .given('a queued image job')
        .uponReceiving('a request for the jobs of a file')
        .withRequest('GET', '/internal/jobs', (b) =>
          b.query({
            userId: fromState('userId'),
            types: MEDIA_JOB_TYPES.join(','),
            assetId: fromState('assetId'),
            limit: '10',
          }),
        )
        .willRespondWith(200, (b) => b.jsonBody({ items: eachLike(job()), nextCursor: null }))
        .executeTest(async ({ url }) => {
          const page = await metadataAt(url).listJobs({
            userId: EXAMPLE.userId,
            types: [...MEDIA_JOB_TYPES],
            assetId: EXAMPLE.assetId,
            limit: 10,
          });
          expect(page.items).toHaveLength(1);
        }));

    it('lists the deliveries to a webhook endpoint', () =>
      pact
        .addInteraction()
        .given('a user with a webhook endpoint')
        .uponReceiving('a request for the deliveries to a webhook endpoint')
        .withRequest('GET', '/internal/jobs', (b) =>
          b.query({
            userId: fromState('userId'),
            types: 'webhook.deliver',
            webhookEndpointId: fromState('endpointId'),
          }),
        )
        .willRespondWith(200, (b) => b.jsonBody({ items: [], nextCursor: null }))
        .executeTest(async ({ url }) => {
          const page = await metadataAt(url).listJobs({
            userId: EXAMPLE.userId,
            types: ['webhook.deliver'],
            webhookEndpointId: EXAMPLE.endpointId,
          });
          expect(page.items).toEqual([]);
        }));

    it('redrives a dead job', () =>
      pact
        .addInteraction()
        .given('a dead image job')
        .uponReceiving('a redrive of a dead job')
        .withRequest(
          'POST',
          pathFromState(
            '/internal/jobs/${jobId}/redrive',
            `/internal/jobs/${EXAMPLE.jobId}/redrive`,
          ),
          (b) => b.jsonBody({ actor: like(`user:${EXAMPLE.userId}`) }),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody(
            job({
              status: 'queued',
              class: like('cpu'),
              attempts: integer(5),
              attemptBase: integer(5),
              lastError: like('broken'),
            }),
          ),
        )
        .executeTest(async ({ url }) => {
          const redriven = await metadataAt(url).redrive(EXAMPLE.jobId, {
            actor: `user:${EXAMPLE.userId}`,
          });
          expect(redriven.status).toBe('queued');
        }));
  });

  describe('assets', () => {
    it('records an upload', () =>
      pact
        .addInteraction()
        .given('a user')
        .uponReceiving('a new upload')
        .withRequest('POST', '/internal/assets', (b) =>
          b.jsonBody({
            userId: fromState('userId'),
            key: fromState('sourceKey'),
            contentType: 'image/png',
            size: 1024,
            name: 'a.png',
          }),
        )
        .willRespondWith(201, (b) => b.jsonBody(asset()))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).createAsset({
              userId: EXAMPLE.userId,
              key: EXAMPLE.sourceKey,
              contentType: 'image/png',
              size: 1024,
              name: 'a.png',
            }),
          ).resolves.toMatchObject({ kind: 'image' });
        }));

    it('lists the files of a user', () =>
      pact
        .addInteraction()
        .given('a queued image job')
        .uponReceiving('a request for the files of a user')
        .withRequest('GET', '/internal/assets', (b) =>
          b.query({ userId: fromState('userId'), kind: 'image', limit: '20' }),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody({
            items: eachLike({
              ...asset(),
              preview: null,
              latestJob: {
                id: uuid(EXAMPLE.jobId),
                type: 'image.resize',
                status: 'queued',
                progress: null,
              },
              dubs: [],
            }),
            nextCursor: null,
          }),
        )
        .executeTest(async ({ url }) => {
          const page = await metadataAt(url).listAssets({
            userId: EXAMPLE.userId,
            kind: 'image',
            limit: 20,
          });
          expect(page.items[0]?.latestJob?.status).toBe('queued');
        }));

    it('reads a file', () =>
      pact
        .addInteraction()
        .given('a user with an uploaded image')
        .uponReceiving('a request for a file')
        .withRequest('GET', assetPath, (b) => b.query({ userId: fromState('userId') }))
        .willRespondWith(200, (b) => b.jsonBody(asset()))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).getAsset(EXAMPLE.assetId, EXAMPLE.userId),
          ).resolves.toMatchObject({ id: EXAMPLE.assetId });
        }));

    it('reports a file of another user as missing', () =>
      pact
        .addInteraction()
        .given('a user')
        .uponReceiving('a request for a file the user does not have')
        .withRequest('GET', `/internal/assets/${EXAMPLE.assetId}`, (b) =>
          b.query({ userId: fromState('userId') }),
        )
        .willRespondWith(404, (b) => b.jsonBody(errorBody('ASSET_NOT_FOUND')))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).getAsset(EXAMPLE.assetId, EXAMPLE.userId)).rejects.toEqual(
            rejects('ASSET_NOT_FOUND'),
          );
        }));

    it('deletes a file', () =>
      pact
        .addInteraction()
        .given('a user with an uploaded image')
        .uponReceiving('a deletion of a file')
        .withRequest('DELETE', assetPath, (b) => b.query({ userId: fromState('userId') }))
        .willRespondWith(200, (b) => b.jsonBody(asset()))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).deleteAsset(EXAMPLE.assetId, EXAMPLE.userId),
          ).resolves.toMatchObject({ id: EXAMPLE.assetId });
        }));
  });

  describe('webhooks', () => {
    it('registers an endpoint', () =>
      pact
        .addInteraction()
        .given('a user')
        .uponReceiving('a new webhook endpoint')
        .withRequest('POST', '/internal/webhooks', (b) =>
          b.jsonBody({
            userId: fromState('userId'),
            url: 'https://example.com/hooks',
            events: ['job.succeeded', 'job.dead'],
          }),
        )
        .willRespondWith(201, (b) =>
          b.jsonBody({ ...webhookEndpoint(), secret: like('whsec_secret') }),
        )
        .executeTest(async ({ url }) => {
          const endpoint = await metadataAt(url).createWebhookEndpoint({
            userId: EXAMPLE.userId,
            url: 'https://example.com/hooks',
            events: ['job.succeeded', 'job.dead'],
          });
          expect(endpoint.secret).toBeTruthy();
        }));

    it('lists the endpoints of a user', () =>
      pact
        .addInteraction()
        .given('a user with a webhook endpoint')
        .uponReceiving('a request for the webhook endpoints of a user')
        .withRequest('GET', '/internal/webhooks', (b) => b.query({ userId: fromState('userId') }))
        .willRespondWith(200, (b) => b.jsonBody({ items: eachLike(webhookEndpoint()) }))
        .executeTest(async ({ url }) => {
          const { items } = await metadataAt(url).listWebhookEndpoints(EXAMPLE.userId);
          expect(items).toHaveLength(1);
        }));

    it('deletes an endpoint', () =>
      pact
        .addInteraction()
        .given('a user with a webhook endpoint')
        .uponReceiving('a deletion of a webhook endpoint')
        .withRequest(
          'DELETE',
          pathFromState(
            '/internal/webhooks/${endpointId}',
            `/internal/webhooks/${EXAMPLE.endpointId}`,
          ),
          (b) => b.query({ userId: fromState('userId') }),
        )
        .willRespondWith(200, (b) => b.jsonBody(webhookEndpoint()))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).deleteWebhookEndpoint(EXAMPLE.endpointId, EXAMPLE.userId),
          ).resolves.toMatchObject({ id: EXAMPLE.endpointId });
        }));
  });

  describe('accounts', () => {
    it('registers a user', () =>
      pact
        .addInteraction()
        .uponReceiving('a registration')
        .withRequest('POST', '/internal/auth/register', (b) =>
          b.jsonBody({ ...CREDENTIALS, name: 'Pact' }),
        )
        .willRespondWith(201, (b) => b.jsonBody(user()))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).register({ ...CREDENTIALS, name: 'Pact' }),
          ).resolves.toMatchObject({ name: 'Pact' });
        }));

    it('refuses an email that is taken', () =>
      pact
        .addInteraction()
        .given('a user who signs in with an email and password')
        .uponReceiving('a registration with a taken email')
        .withRequest('POST', '/internal/auth/register', (b) => b.jsonBody(CREDENTIALS))
        .willRespondWith(409, (b) => b.jsonBody(errorBody('EMAIL_TAKEN')))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).register(CREDENTIALS)).rejects.toEqual(
            rejects('EMAIL_TAKEN'),
          );
        }));

    it('signs a user in', () =>
      pact
        .addInteraction()
        .given('a user who signs in with an email and password')
        .uponReceiving('a sign-in with the right password')
        .withRequest('POST', '/internal/auth/login', (b) => b.jsonBody(CREDENTIALS))
        .willRespondWith(200, (b) => b.jsonBody(user({ email: CREDENTIALS.email })))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).login(CREDENTIALS)).resolves.toMatchObject({
            email: CREDENTIALS.email,
          });
        }));

    it('refuses a wrong password', () =>
      pact
        .addInteraction()
        .given('a user who signs in with an email and password')
        .uponReceiving('a sign-in with a wrong password')
        .withRequest('POST', '/internal/auth/login', (b) =>
          b.jsonBody({ email: CREDENTIALS.email, password: 'wrong-password' }),
        )
        .willRespondWith(401, (b) => b.jsonBody(errorBody('INVALID_CREDENTIALS')))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).login({ email: CREDENTIALS.email, password: 'wrong-password' }),
          ).resolves.toBeNull();
        }));

    it('reads a user', () =>
      pact
        .addInteraction()
        .given('a user')
        .uponReceiving('a request for a user')
        .withRequest('GET', userPath())
        .willRespondWith(200, (b) => b.jsonBody(user({ email: null })))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).getUser(EXAMPLE.userId)).resolves.toMatchObject({
            id: EXAMPLE.userId,
          });
        }));

    it('reads the dub quota of a user', () =>
      pact
        .addInteraction()
        .given('a user, with no system-wide dub limit')
        .uponReceiving('a request for the dub quota of a user')
        .withRequest('GET', userPath('/dub-quota'))
        .willRespondWith(200, (b) =>
          b.jsonBody({
            usedSeconds: integer(0),
            limitSeconds: integer(600),
            systemRemainingSeconds: null,
            resetsAt: timestamp,
          }),
        )
        .executeTest(async ({ url }) => {
          const quota = await metadataAt(url).getDubQuota(EXAMPLE.userId);
          expect(quota.limitSeconds).toBeGreaterThan(0);
        }));
  });

  describe('API keys', () => {
    it('lists the keys of a user', () =>
      pact
        .addInteraction()
        .given('a user')
        .uponReceiving('a request for the API keys of a user')
        .withRequest('GET', '/internal/api-keys', (b) => b.query({ userId: fromState('userId') }))
        .willRespondWith(200, (b) => b.jsonBody({ items: eachLike(apiKey()) }))
        .executeTest(async ({ url }) => {
          const { items } = await metadataAt(url).listApiKeys(EXAMPLE.userId);
          expect(items).toHaveLength(1);
        }));

    it('creates a key', () =>
      pact
        .addInteraction()
        .given('a user')
        .uponReceiving('a new API key')
        .withRequest('POST', '/internal/api-keys', (b) =>
          b.jsonBody({ userId: fromState('userId'), name: 'ci' }),
        )
        .willRespondWith(201, (b) => b.jsonBody({ ...apiKey(), key: like(API_KEY) }))
        .executeTest(async ({ url }) => {
          const created = await metadataAt(url).createApiKey({
            userId: EXAMPLE.userId,
            name: 'ci',
          });
          expect(created.key).toBeTruthy();
        }));

    it('revokes a key', () =>
      pact
        .addInteraction()
        .given('a user with a second API key')
        .uponReceiving('a revocation of an API key')
        .withRequest(
          'DELETE',
          pathFromState('/internal/api-keys/${apiKeyId}', `/internal/api-keys/${EXAMPLE.apiKeyId}`),
          (b) => b.query({ userId: fromState('userId') }),
        )
        .willRespondWith(200, (b) => b.jsonBody(apiKey()))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).revokeApiKey(EXAMPLE.apiKeyId, EXAMPLE.userId),
          ).resolves.toMatchObject({ id: EXAMPLE.apiKeyId });
        }));

    it('resolves a key to its user', () =>
      pact
        .addInteraction()
        .given('a user with a known API key')
        .uponReceiving('a lookup of a known API key')
        .withRequest('POST', '/internal/auth/resolve', (b) =>
          b.jsonBody({ apiKeyHash: hashApiKey(API_KEY) }),
        )
        .willRespondWith(200, (b) => b.jsonBody({ userId: uuid(EXAMPLE.userId) }))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).resolveApiKey(hashApiKey(API_KEY))).resolves.toBe(
            EXAMPLE.userId,
          );
        }));

    it('finds no user for an unknown key', () =>
      pact
        .addInteraction()
        .uponReceiving('a lookup of an unknown API key')
        .withRequest('POST', '/internal/auth/resolve', (b) =>
          b.jsonBody({ apiKeyHash: hashApiKey('pdp_unknown') }),
        )
        .willRespondWith(404, (b) => b.jsonBody(errorBody('API_KEY_NOT_FOUND')))
        .executeTest(async ({ url }) => {
          await expect(
            metadataAt(url).resolveApiKey(hashApiKey('pdp_unknown')),
          ).resolves.toBeNull();
        }));
  });
});
