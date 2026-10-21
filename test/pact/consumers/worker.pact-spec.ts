import { MatchersV3 } from '@pact-foundation/pact';
import { ImageResizeInputV1, WebhookDeliverInputV1 } from '@pdp/contracts';
import { AssetPurgeHandler } from '../../../apps/worker/src/assets/asset-purge.handler';
import { describeDispatches, describeJobRunner } from '../support/job-runner';
import {
  ASSET_DELETED,
  assetDeletedMessage,
  DISPATCH_INPUTS,
  messageBytes,
} from '../support/messages';
import {
  errorBody,
  EXAMPLE,
  fromState,
  job,
  metadataAt,
  pactBetween,
  pathFromState,
  webhookEndpoint,
} from '../support/pact';

const { eachLike, like } = MatchersV3;

const pact = pactBetween('worker', 'metadata');
const fromScheduler = pactBetween('worker', 'scheduler');

describe('worker → metadata', () => {
  describeJobRunner(pact, {
    type: 'image.resize',
    consumer: 'worker-cpu',
    inputSchema: ImageResizeInputV1,
    input: DISPATCH_INPUTS['image.resize'],
    output: {
      results: [
        { preset: 'thumb', key: 'results/job/thumb.webp', width: 200, height: 133, bytes: 4096 },
      ],
    },
  });

  describe('webhook delivery', () => {
    it('reads the endpoint with its signing secret', () =>
      pact
        .addInteraction()
        .given('a user with a webhook endpoint')
        .uponReceiving('a request for a webhook endpoint with its secret')
        .withRequest(
          'GET',
          pathFromState(
            '/internal/webhooks/${endpointId}',
            `/internal/webhooks/${EXAMPLE.endpointId}`,
          ),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody({ ...webhookEndpoint(), secret: like('whsec_secret') }),
        )
        .executeTest(async ({ url }) => {
          const endpoint = await metadataAt(url).getWebhookEndpoint(EXAMPLE.endpointId);
          expect(endpoint.secret).toBeTruthy();
        }));

    it('learns that the endpoint was deleted', () =>
      pact
        .addInteraction()
        .uponReceiving('a request for a deleted webhook endpoint')
        .withRequest('GET', `/internal/webhooks/${EXAMPLE.endpointId}`)
        .willRespondWith(404, (b) => b.jsonBody(errorBody('WEBHOOK_NOT_FOUND')))
        .executeTest(async ({ url }) => {
          await expect(metadataAt(url).getWebhookEndpoint(EXAMPLE.endpointId)).rejects.toEqual(
            expect.objectContaining({ code: 'WEBHOOK_NOT_FOUND' }),
          );
        }));
  });

  describe('purge of a deleted file', () => {
    it('purges the original of a deleted file', () =>
      pact
        .addAsynchronousInteraction()
        .given('a file the user deleted')
        .expectsToReceive(ASSET_DELETED, (b) =>
          b.withJSONContent(assetDeletedMessage.content).withMetadata(assetDeletedMessage.metadata),
        )
        .executeTest(async (message) => {
          const deleteObject = jest.fn(() => Promise.resolve());
          const handler = new AssetPurgeHandler({
            listJobIds: () => Promise.resolve({ ids: [], nextCursor: null }),
            deleteObject,
            deletePrefix: () => Promise.resolve(0),
          });
          await expect(handler.handle(messageBytes(message.contents.content))).resolves.toEqual({
            kind: 'ack',
          });
          expect(deleteObject).toHaveBeenCalledWith(EXAMPLE.sourceKey);
        }));

    it('lists the jobs of the file', () =>
      pact
        .addInteraction()
        .given('a queued image job')
        .uponReceiving('a request for a page of the jobs of a file')
        .withRequest('GET', '/internal/jobs', (b) =>
          b.query({ userId: fromState('userId'), assetId: fromState('assetId'), limit: '100' }),
        )
        .willRespondWith(200, (b) => b.jsonBody({ items: eachLike(job()), nextCursor: null }))
        .executeTest(async ({ url }) => {
          const page = await metadataAt(url).listJobs({
            userId: EXAMPLE.userId,
            assetId: EXAMPLE.assetId,
            limit: 100,
          });
          expect(page.items.map((j) => j.id)).toEqual([EXAMPLE.jobId]);
        }));
  });
});

describe('worker ← scheduler', () => {
  describeDispatches(fromScheduler, [
    { type: 'image.resize', inputSchema: ImageResizeInputV1 },
    { type: 'webhook.deliver', inputSchema: WebhookDeliverInputV1 },
  ]);
});
