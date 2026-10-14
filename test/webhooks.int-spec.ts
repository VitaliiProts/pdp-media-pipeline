import { deadLetterSubject, JobDeadLetteredV1, WebhookPayloadV1 } from '@pdp/contracts';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Pool } from 'pg';
import { createReceiver, type ReceivedDelivery } from '../apps/webhook-receiver/src/receiver';
import { seedUser } from '../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, putSource, readStream, waitFor } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

const MAX_ATTEMPTS = 3;
const WEBHOOK_TIMEOUT_MS = 1000;

interface Delivery {
  id: string;
  messageId: string;
  event: string;
  jobId: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  deadReason: string | null;
}

type Received = ReceivedDelivery & { signatureValid: boolean | null };

describe('webhooks', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let gateway: string;
  let receiver: Server;
  let receiverUrl: string;

  beforeAll(async () => {
    infra = await startInfra();
    ({ pool } = await prepareDatabase(infra));
    receiver = createReceiver();
    // All interfaces: `localhost` may resolve to ::1 first.
    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    receiverUrl = `http://localhost:${(receiver.address() as AddressInfo).port}`;

    apps = createApps(infra);
    await apps.start('metadata', { JOB_MAX_ATTEMPTS: String(MAX_ATTEMPTS) });
    await apps.start('scheduler');
    const egress = { EGRESS_PRIVATE_HOSTS: 'localhost' };
    await apps.start('worker', {
      ...egress,
      WEBHOOK_TIMEOUT_MS: String(WEBHOOK_TIMEOUT_MS),
      WORKER_RETRY_BASE_MS: '50',
      WORKER_RETRY_MAX_MS: '200',
    });
    gateway = await apps.start('api-gateway', egress);
  });

  afterAll(async () => {
    await apps?.stopAll();
    receiver?.closeAllConnections();
    await new Promise((resolve) => receiver?.close(resolve));
    await pool?.end();
    await infra?.stop();
  });

  /** Every test gets its own user, so endpoints and deliveries do not mix. */
  async function newUser() {
    const user = await seedUser(infra.databaseUrl, `webhooks-${Date.now()}-${Math.random()}`);
    const api = async <T>(path: string, init: RequestInit = {}) => {
      const res = await fetch(`${gateway}${path}`, {
        ...init,
        headers: { 'x-api-key': user.apiKey, 'content-type': 'application/json', ...init.headers },
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
    };
    const register = async (path: string, events?: string[]) => {
      const res = await api<{ id: string; secret: string; url: string }>('/v1/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: `${receiverUrl}${path}`, events }),
      });
      expect(res.status).toBe(201);
      return res.body;
    };
    const finishImageJob = async (name: string, image?: Buffer) => {
      const sourceKey = `uploads/${user.userId}/${name}.png`;
      await putSource(infra.s3, pool, sourceKey, image ?? (await pngImage(200, 100)));
      const created = await api<{ jobId: string }>('/v1/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'image.resize', sourceKey, presets: ['thumb'] }),
      });
      expect(created.status).toBe(202);
      return created.body.jobId;
    };
    const deliveries = async (endpointId: string) =>
      (await api<{ items: Delivery[] }>(`/v1/webhooks/${endpointId}/deliveries`)).body.items;
    const settled = (endpointId: string, status: 'succeeded' | 'dead', timeoutMs = 30_000) =>
      waitFor(
        async () => {
          const [delivery] = await deliveries(endpointId);
          return delivery?.status === status ? delivery : undefined;
        },
        { what: `delivery to be ${status}`, timeoutMs, intervalMs: 200 },
      );
    return { user, api, register, finishImageJob, deliveries, settled };
  }

  const received = async (secret: string, webhookId: string): Promise<Received[]> => {
    const res = await fetch(`${receiverUrl}/deliveries?secret=${encodeURIComponent(secret)}`);
    const { items } = (await res.json()) as { items: Received[] };
    return items.filter((d) => d.webhookId === webhookId).reverse();
  };

  it('registers endpoints without listing their secret', async () => {
    const { api, register } = await newUser();
    const created = await register('/ok');
    expect(created.secret).toMatch(/^whsec_/);

    const list = await api<{ items: Record<string, unknown>[] }>('/v1/webhooks');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty('secret');

    expect((await api(`/v1/webhooks/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api<{ items: unknown[] }>('/v1/webhooks')).body.items).toEqual([]);
  });

  it.each(['http://127.0.0.1:9/hook', 'http://169.254.169.254/', 'ftp://example.com/hook'])(
    'refuses to register %s',
    async (url) => {
      const { api } = await newUser();
      const res = await api('/v1/webhooks', { method: 'POST', body: JSON.stringify({ url }) });
      expect(res.status).toBe(400);
    },
  );

  it('limits endpoints per user', async () => {
    const { api, register } = await newUser();
    for (let i = 0; i < 5; i++) await register(`/ok?n=${i}`);
    const res = await api<{ code: string }>('/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: `${receiverUrl}/ok` }),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WEBHOOK_LIMIT_REACHED');
  });

  it('delivers a signed job.succeeded notification', async () => {
    const { api, register, finishImageJob, settled } = await newUser();
    const endpoint = await register('/ok');
    const jobId = await finishImageJob('signed');

    const delivery = await settled(endpoint.id, 'succeeded');
    expect(delivery).toMatchObject({
      event: 'job.succeeded',
      jobId,
      attempts: 1,
      responseStatus: 204,
    });

    const [request] = await received(endpoint.secret, delivery.messageId);
    expect(request?.signatureValid).toBe(true);
    const payload = WebhookPayloadV1.parse(JSON.parse(request!.body));
    expect(payload).toMatchObject({ type: 'job.succeeded', data: { jobId, status: 'succeeded' } });

    // Deliveries are jobs, but not part of the user's media job list.
    const jobs = await api<{ items: { id: string }[] }>('/v1/jobs');
    expect(jobs.body.items.map((j) => j.id)).toEqual([jobId]);
  });

  it('notifies only subscribed events, including job.dead', async () => {
    const { register, finishImageJob, settled, deliveries } = await newUser();
    const onlyDead = await register('/ok', ['job.dead']);
    await finishImageJob('broken', Buffer.from('not an image'));

    const delivery = await settled(onlyDead.id, 'succeeded');
    expect(delivery.event).toBe('job.dead');
    await finishImageJob('fine');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await deliveries(onlyDead.id)).toHaveLength(1);
  });

  it('gets through a flaky receiver after retries, with a stable webhook-id', async () => {
    const { register, finishImageJob, settled } = await newUser();
    const endpoint = await register('/flaky?failures=2');
    await finishImageJob('flaky');

    const delivery = await settled(endpoint.id, 'succeeded');
    expect(delivery).toMatchObject({ attempts: 3, responseStatus: 200 });
    const requests = await received(endpoint.secret, delivery.messageId);
    expect(requests.map((r) => r.responseStatus)).toEqual([500, 500, 200]);
    expect(requests.every((r) => r.signatureValid)).toBe(true);
  });

  it.each([
    ['always 500', '/fail', 'endpoint responded 500'],
    ['a dropped connection', '/drop', 'localhost'],
    ['a response slower than the timeout', `/slow?ms=${WEBHOOK_TIMEOUT_MS * 3}`, 'timed out'],
  ])('dead-letters a delivery after %s', async (_name, path, error) => {
    const { register, finishImageJob, settled } = await newUser();
    const endpoint = await register(path);
    await finishImageJob('bad-receiver');

    const delivery = await settled(endpoint.id, 'dead');
    expect(delivery).toMatchObject({ deadReason: 'exhausted', attempts: MAX_ATTEMPTS });
    expect(delivery.lastError).toContain(error);
    expect((await received(endpoint.secret, delivery.messageId)).length).toBe(MAX_ATTEMPTS);

    const dlq = (await readStream(infra.natsUrl, 'JOBS_DLQ', deadLetterSubject('webhook.deliver')))
      .map((e) => JobDeadLetteredV1.parse(e))
      .filter((e) => e.payload.jobId === delivery.id);
    expect(dlq).toHaveLength(1);
  });

  it('gives up at once on a permanent 4xx and redelivers the same message on redrive', async () => {
    const { api, register, finishImageJob, settled } = await newUser();
    const endpoint = await register('/status/410');
    await finishImageJob('gone');

    const dead = await settled(endpoint.id, 'dead');
    expect(dead).toMatchObject({ deadReason: 'permanent', attempts: 1 });

    const redrive = await api(`/v1/jobs/${dead.id}/redrive`, { method: 'POST' });
    expect(redrive.status).toBe(202);
    await waitFor(async () => (await received(endpoint.secret, dead.messageId)).length === 2, {
      what: 'the redriven delivery',
    });
  });
});
