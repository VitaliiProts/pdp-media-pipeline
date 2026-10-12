import { generateWebhookSecret, signWebhook } from '@pdp/contracts';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createReceiver, type ReceivedDelivery } from './receiver';

let server: Server;
let base: string;

const logged: string[] = [];

beforeEach(async () => {
  logged.length = 0;
  server = createReceiver({ log: (line) => logged.push(line) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const post = (path: string, id = 'msg_1') =>
  fetch(`${base}${path}`, { method: 'POST', body: '{}', headers: { 'webhook-id': id } });

type Listed = ReceivedDelivery & { signatureValid: boolean | null };

async function deliveries(secret?: string): Promise<Listed[]> {
  const query = secret ? `?secret=${encodeURIComponent(secret)}` : '';
  const res = await fetch(`${base}/deliveries${query}`);
  return ((await res.json()) as { items: Listed[] }).items;
}

describe('webhook receiver', () => {
  it.each([
    ['/ok', 204],
    ['/fail', 500],
    ['/status/410', 410],
    ['/unknown', 404],
  ])('%s answers %i', async (path, status) => {
    expect((await post(path)).status).toBe(status);
  });

  it('answers GET the same way, for use as a source URL', async () => {
    expect((await fetch(`${base}/fail`)).status).toBe(500);
  });

  it('fails the first N attempts of each webhook-id on /flaky', async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post('/flaky?failures=2', 'msg_a')).status);
    statuses.push((await post('/flaky?failures=2', 'msg_b')).status);
    expect(statuses).toEqual([500, 500, 200, 500]);
  });

  it('answers /slow after the delay', async () => {
    const started = Date.now();
    expect((await post('/slow?ms=200')).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('drops the connection on /drop', async () => {
    await expect(post('/drop')).rejects.toThrow();
    expect((await deliveries())[0]).toMatchObject({ path: '/drop', responseStatus: null });
  });

  it('records deliveries and checks their signature', async () => {
    const secret = generateWebhookSecret();
    const timestamp = Math.floor(Date.now() / 1000);
    const body = '{"type":"job.succeeded"}';
    await fetch(`${base}/ok`, {
      method: 'POST',
      body,
      headers: {
        'webhook-id': 'msg_signed',
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signWebhook({ secret, id: 'msg_signed', timestamp, body }),
      },
    });

    const [delivery] = await deliveries(secret);
    expect(delivery).toMatchObject({
      path: '/ok',
      webhookId: 'msg_signed',
      body,
      responseStatus: 204,
      signatureValid: true,
    });
    expect((await deliveries(generateWebhookSecret()))[0]?.signatureValid).toBe(false);

    await fetch(`${base}/deliveries`, { method: 'DELETE' });
    expect(await deliveries()).toEqual([]);
  });

  it('logs and lists alerts from Alertmanager', async () => {
    const notification = {
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'JobSloBurnRateFast', type: 'image.resize' },
          annotations: { summary: 'burning' },
          startsAt: '2026-10-12T10:00:00Z',
        },
      ],
    };
    const res = await fetch(`${base}/alerts`, {
      method: 'POST',
      body: JSON.stringify(notification),
    });
    expect(res.status).toBe(200);
    expect(logged).toEqual(['alert firing: alertname=JobSloBurnRateFast type=image.resize']);

    const listed = await fetch(`${base}/alerts`).then((r) => r.json());
    expect(listed).toEqual({
      items: [{ ...notification.alerts[0], receivedAt: expect.any(String) as string }],
    });
    // Webhook traffic must not push alerts out of a shared buffer.
    expect(await deliveries()).toEqual([]);
  });
});
