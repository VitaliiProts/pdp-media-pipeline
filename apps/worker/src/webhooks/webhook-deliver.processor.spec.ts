import {
  generateWebhookSecret,
  verifyWebhook,
  type WebhookDeliverInputV1,
  type WebhookEndpointWithSecretDto,
} from '@pdp/contracts';
import { EgressError, type EgressRequest, type EgressResponse } from '@pdp/egress';
import { isPermanentError } from '@pdp/worker-kit';
import { randomUUID } from 'node:crypto';
import { WebhookDeliverProcessor } from './webhook-deliver.processor';

const secret = generateWebhookSecret();
const endpoint: WebhookEndpointWithSecretDto = {
  id: randomUUID(),
  userId: randomUUID(),
  url: 'https://hooks.example/pdp',
  events: ['job.succeeded'],
  secret,
  createdAt: new Date().toISOString(),
};

const input: WebhookDeliverInputV1 = {
  endpointId: endpoint.id,
  messageId: 'msg_abc',
  payload: {
    type: 'job.succeeded',
    timestamp: new Date().toISOString(),
    data: {
      jobId: randomUUID(),
      jobType: 'image.resize',
      status: 'succeeded',
      attempts: 1,
      deadReason: null,
      lastError: null,
      output: { results: [] },
      finishedAt: new Date().toISOString(),
    },
  },
};

const response = (status: number): EgressResponse => ({
  status,
  headers: {},
  body: Buffer.alloc(0),
  bytes: 0,
  url: endpoint.url,
});

function setup(status = 204) {
  const now = 1_800_000_000_000;
  const deps = {
    getEndpoint: jest.fn<Promise<WebhookEndpointWithSecretDto | null>, [string]>(() =>
      Promise.resolve(endpoint),
    ),
    request: jest.fn<Promise<EgressResponse>, [string, EgressRequest]>(() =>
      Promise.resolve(response(status)),
    ),
    now: () => now,
  };
  const processor = new WebhookDeliverProcessor(deps, { timeoutMs: 5000 });
  const run = () => processor.process({ jobId: randomUUID(), attempt: 1 }, input);
  return { deps, run, nowSeconds: now / 1000 };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (err: Error) => err,
  );
}

describe('WebhookDeliverProcessor', () => {
  it('posts the payload with Standard Webhooks headers and a valid signature', async () => {
    const { deps, run, nowSeconds } = setup();
    await expect(run()).resolves.toEqual({ statusCode: 204, durationMs: 0 });

    const [url, req] = deps.request.mock.calls[0]!;
    expect(url).toBe(endpoint.url);
    expect(req).toMatchObject({ method: 'POST', timeoutMs: 5000 });
    const headers = req.headers!;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['webhook-id']).toBe('msg_abc');
    expect(headers['webhook-timestamp']).toBe(String(nowSeconds));
    expect(
      verifyWebhook({
        secret,
        id: 'msg_abc',
        timestamp: nowSeconds,
        body: req.body as string,
        signatureHeader: headers['webhook-signature']!,
        nowSeconds,
      }),
    ).toBe(true);
    expect(JSON.parse(req.body as string)).toEqual(input.payload);
  });

  it.each([400, 404, 410])('treats %i as permanent', async (status) => {
    const err = await failure(setup(status).run());
    expect(isPermanentError(err)).toBe(true);
    expect(err.message).toBe(`endpoint responded ${status}`);
  });

  it.each([408, 429, 500, 503])('retries %i', async (status) => {
    expect(isPermanentError(await failure(setup(status).run()))).toBe(false);
  });

  it('gives up when the endpoint was deleted', async () => {
    const { deps, run } = setup();
    deps.getEndpoint.mockResolvedValueOnce(null);
    expect(isPermanentError(await failure(run()))).toBe(true);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('passes egress errors through with their classification', async () => {
    const { deps, run } = setup();
    deps.request.mockRejectedValueOnce(new EgressError('TIMEOUT', 'timed out'));
    expect(isPermanentError(await failure(run()))).toBe(false);
    deps.request.mockRejectedValueOnce(new EgressError('BLOCKED_ADDRESS', 'private'));
    expect(isPermanentError(await failure(run()))).toBe(true);
  });
});
