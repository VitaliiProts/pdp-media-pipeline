import {
  verifyWebhook,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@pdp/contracts';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export interface ReceivedDelivery {
  path: string;
  receivedAt: string;
  webhookId: string | null;
  timestamp: number | null;
  signature: string | null;
  body: string;
  /** What this receiver answered; `null` when it dropped the connection. */
  responseStatus: number | null;
}

const MAX_KEPT = 500;
const MAX_BODY_BYTES = 1024 * 1024;

const header = (req: IncomingMessage, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) req.destroy(new Error('body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/**
 * A deliberately unreliable webhook endpoint for tests and demos. The path picks the
 * behaviour:
 *
 * - `POST /ok` answers 204;
 * - `POST /fail` answers 500;
 * - `POST /status/<code>` answers that status, e.g. 410 for a permanent failure;
 * - `POST /slow?ms=15000` waits before answering 200;
 * - `POST /drop` closes the connection without an answer;
 * - `POST /flaky?failures=2` answers 500 to the first N attempts of each `webhook-id`.
 *
 * `GET /deliveries?secret=whsec_…` lists what arrived, newest first, with a signature check.
 */
export function createReceiver(): http.Server {
  const deliveries: ReceivedDelivery[] = [];
  const attemptsById = new Map<string, number>();

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://receiver');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health/live') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && path === '/deliveries') {
      const secret = url.searchParams.get('secret');
      return json(res, 200, {
        items: deliveries.map((d) => ({
          ...d,
          signatureValid:
            secret && d.webhookId && d.timestamp !== null && d.signature
              ? verifyWebhook({
                  secret,
                  id: d.webhookId,
                  timestamp: d.timestamp,
                  body: d.body,
                  signatureHeader: d.signature,
                })
              : null,
        })),
      });
    }
    if (req.method === 'DELETE' && path === '/deliveries') {
      deliveries.length = 0;
      attemptsById.clear();
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' });

    void readBody(req).then(
      (body) => {
        const timestamp = Number(header(req, WEBHOOK_TIMESTAMP_HEADER));
        const delivery: ReceivedDelivery = {
          path,
          receivedAt: new Date().toISOString(),
          webhookId: header(req, WEBHOOK_ID_HEADER),
          timestamp: Number.isFinite(timestamp) ? timestamp : null,
          signature: header(req, WEBHOOK_SIGNATURE_HEADER),
          body,
          responseStatus: null,
        };
        deliveries.unshift(delivery);
        deliveries.length = Math.min(deliveries.length, MAX_KEPT);

        const respond = (status: number) => {
          delivery.responseStatus = status;
          res.writeHead(status).end();
        };
        const statusMatch = /^\/status\/(\d{3})$/.exec(path);

        if (path === '/ok') return respond(204);
        if (path === '/fail') return respond(500);
        if (statusMatch) return respond(Number(statusMatch[1]));
        if (path === '/slow') {
          const ms = Number(url.searchParams.get('ms') ?? 15_000);
          const timer = setTimeout(() => respond(200), ms);
          res.on('close', () => clearTimeout(timer));
          return;
        }
        if (path === '/drop') {
          req.socket.destroy();
          return;
        }
        if (path === '/flaky') {
          const failures = Number(url.searchParams.get('failures') ?? 2);
          const key = delivery.webhookId ?? 'anonymous';
          const attempt = (attemptsById.get(key) ?? 0) + 1;
          attemptsById.set(key, attempt);
          return respond(attempt <= failures ? 500 : 200);
        }
        return respond(404);
      },
      () => res.destroy(),
    );
  });
}
