import { SpanKind } from '@opentelemetry/api';
import { startTestTracing, type TestTracing } from '@pdp/observability/testing';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Pool } from 'pg';
import { createReceiver } from '../apps/webhook-receiver/src/receiver';
import { seedUser } from '../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from './support/apps';
import { pngImage, prepareDatabase, putSource, waitFor } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

/**
 * All services run in this process and export into one in-memory exporter, with the real
 * propagation: HTTP between services, NATS headers, and the context stored in the outbox.
 */
describe('one trace per job', () => {
  let tracing: TestTracing;
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let gateway: string;
  let receiver: Server;
  let receiverUrl: string;

  beforeAll(async () => {
    tracing = startTestTracing({ instrumentHttp: true });
    infra = await startInfra();
    ({ pool } = await prepareDatabase(infra));
    receiver = createReceiver();
    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    receiverUrl = `http://localhost:${(receiver.address() as AddressInfo).port}`;

    apps = createApps(infra);
    const egress = { EGRESS_PRIVATE_HOSTS: 'localhost' };
    await apps.start('metadata');
    await apps.start('scheduler');
    await apps.start('worker', egress);
    gateway = await apps.start('api-gateway', egress);
  });

  afterAll(async () => {
    await apps?.stopAll();
    receiver?.closeAllConnections();
    await new Promise((resolve) => receiver?.close(resolve));
    await pool?.end();
    await infra?.stop();
    await tracing?.stop();
  });

  it('follows a job from POST /v1/jobs through scheduler and worker to its webhook', async () => {
    const user = await seedUser(infra.databaseUrl, `tracing-${Date.now()}`);
    const api = async <T>(path: string, init: RequestInit = {}) => {
      const res = await fetch(`${gateway}${path}`, {
        ...init,
        headers: { 'x-api-key': user.apiKey, 'content-type': 'application/json' },
      });
      return { status: res.status, body: (await res.json()) as T };
    };
    const endpoint = await api<{ id: string }>('/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: `${receiverUrl}/ok`, events: ['job.succeeded'] }),
    });
    expect(endpoint.status).toBe(201);
    tracing.reset();

    const sourceKey = `uploads/${user.userId}/traced.png`;
    await putSource(infra.s3, sourceKey, await pngImage(300, 200));
    const created = await api<{ jobId: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ type: 'image.resize', sourceKey, presets: ['thumb'] }),
    });
    expect(created.status).toBe(202);
    const { jobId } = created.body;

    const job = await waitFor(
      async () => {
        const res = await api<{ status: string; traceId: string | null }>(`/v1/jobs/${jobId}`);
        return res.body.status === 'succeeded' ? res.body : undefined;
      },
      { what: 'job to succeed', timeoutMs: 30_000, intervalMs: 200 },
    );
    expect(job.traceId).toMatch(/^[0-9a-f]{32}$/);

    // The delivery is acked last; its consumer span closes the trace.
    const trace = await waitFor(
      () => {
        const spans = tracing.spans().filter((s) => s.spanContext().traceId === job.traceId);
        const delivered = spans.some(
          (s) =>
            s.kind === SpanKind.CONSUMER &&
            s.attributes['job.type'] === 'webhook.deliver' &&
            s.attributes['messaging.nats.outcome'] === 'ack',
        );
        return Promise.resolve(delivered ? spans : undefined);
      },
      { what: 'webhook delivery span', timeoutMs: 30_000, intervalMs: 200 },
    );

    const names = new Set(trace.map((s) => s.name));
    for (const name of [
      'job create',
      'send events.job.created.v1',
      'process events.job.created.v1',
      'source fetch',
      'sharp metadata',
      'sharp resize',
      'job process image.resize',
      'job process webhook.deliver',
      'egress POST',
    ]) {
      expect(names).toContain(name);
    }

    // Dispatch subjects depend on the class; check by kind and job instead.
    const workerSpan = trace.find(
      (s) => s.kind === SpanKind.CONSUMER && s.attributes['job.type'] === 'image.resize',
    );
    expect(workerSpan?.attributes).toMatchObject({ 'job.id': jobId, 'job.class': 'cpu' });

    // The delivery is its own job inside the same trace.
    const delivery = trace.find((s) => s.name === 'job process webhook.deliver');
    expect(delivery?.attributes['job.id']).not.toBe(jobId);

    // Every span of the trace has a parent in it, except the gateway's server span.
    const ids = new Set(trace.map((s) => s.spanContext().spanId));
    const roots = trace.filter((s) => !s.parentSpanContext || !ids.has(s.parentSpanContext.spanId));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.kind).toBe(SpanKind.SERVER);
  });
});
