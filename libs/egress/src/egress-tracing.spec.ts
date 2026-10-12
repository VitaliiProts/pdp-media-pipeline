import { SpanKind } from '@opentelemetry/api';
import { startTestTracing, type TestTracing } from '@pdp/observability/testing';
import { traced, withJobContext } from '@pdp/observability';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { EgressClient } from './egress-client';

let tracing: TestTracing;
let server: http.Server;
let port: number;
let received: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  tracing = startTestTracing({ instrumentHttp: true });
  server = http.createServer((req, res) => {
    received.push(req.headers);
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  received = [];
  tracing.reset();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await tracing.stop();
});

const client = new EgressClient({
  timeoutMs: 2000,
  maxBytes: 1024,
  perHostConcurrency: 4,
  userAgent: 'pdp-test',
  privateHosts: ['media.test'],
  resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
});

const inJob = <T>(fn: () => Promise<T>): Promise<T> =>
  traced('job', {}, () => withJobContext({ id: 'job-1' }, fn));

describe('egress tracing', () => {
  it('propagates context on ordinary requests (control)', async () => {
    await inJob(
      () =>
        new Promise<void>((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${port}/`, (res) => res.resume().on('end', resolve))
            .on('error', reject);
        }),
    );
    expect(received[0]).toHaveProperty('traceparent');
  });

  it('records one client span without leaking trace context or job ids', async () => {
    await inJob(() => client.request(`http://media.test:${port}/hook?token=secret`));

    expect(received[0]).not.toHaveProperty('traceparent');
    expect(received[0]).not.toHaveProperty('baggage');
    const clientSpans = tracing.spans().filter((s) => s.kind === SpanKind.CLIENT);
    expect(clientSpans.map((s) => s.name)).toEqual(['egress GET']);
    expect(clientSpans[0]?.attributes).toMatchObject({
      'server.address': 'media.test',
      'http.response.status_code': 200,
      'job.id': 'job-1',
    });
    expect(JSON.stringify(clientSpans[0]?.attributes)).not.toContain('secret');
  });
});
