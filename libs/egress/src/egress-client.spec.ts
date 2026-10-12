import http from 'node:http';
import { type AddressInfo } from 'node:net';
import {
  classifyStatus,
  EgressClient,
  type EgressClientOptions,
  EgressError,
} from './egress-client';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let port: number;
let handler: Handler;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** `media.test` stands for a public host name that the stub resolver maps to the test server. */
function client(overrides: Partial<EgressClientOptions> = {}): EgressClient {
  return new EgressClient({
    timeoutMs: 2000,
    maxBytes: 1024,
    perHostConcurrency: 4,
    userAgent: 'pdp-test',
    privateHosts: ['media.test'],
    resolve: (hostname) =>
      Promise.resolve(hostname === 'media.test' ? [{ address: '127.0.0.1', family: 4 }] : []),
    ...overrides,
  });
}

async function failure(promise: Promise<unknown>): Promise<EgressError> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof EgressError)) throw new Error(`expected EgressError, got ${String(err)}`);
  return err;
}

describe('EgressClient', () => {
  it('connects to the validated address and keeps the original Host header', async () => {
    handler = (req, res) => res.end(`host=${req.headers.host}`);
    const res = await client().request(`http://media.test:${port}/a`);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(`host=media.test:${port}`);
  });

  it.each(['ftp://media.test/a', 'file:///etc/passwd', 'http://user:pw@media.test/', 'nope'])(
    'rejects %s as a permanent INVALID_URL',
    async (url) => {
      const err = await failure(client().request(url));
      expect(err.code).toBe('INVALID_URL');
      expect(err.permanent).toBe(true);
    },
  );

  it.each(['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data'])(
    'blocks the literal address %s',
    async (url) => {
      const err = await failure(client().request(url));
      expect(err.code).toBe('BLOCKED_ADDRESS');
      expect(err.permanent).toBe(true);
    },
  );

  it('blocks a host name when any of its addresses is private', async () => {
    const egress = client({
      resolve: () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
    });
    expect((await failure(egress.request('http://rebind.example/'))).code).toBe('BLOCKED_ADDRESS');
    expect((await failure(egress.check('http://rebind.example/'))).code).toBe('BLOCKED_ADDRESS');
  });

  it('treats a failed resolution as transient', async () => {
    const egress = client({ resolve: () => Promise.reject(new Error('ENOTFOUND')) });
    const err = await failure(egress.request('http://missing.example/'));
    expect(err.code).toBe('RESOLVE_FAILED');
    expect(err.permanent).toBe(false);
  });

  it('follows redirects and checks every hop', async () => {
    handler = (req, res) => {
      if (req.url === '/start') res.writeHead(302, { location: '/end' }).end();
      else if (req.url === '/end') res.end('done');
      else res.writeHead(302, { location: `http://127.0.0.1:${port}/end` }).end();
    };
    const res = await client().request(`http://media.test:${port}/start`);
    expect(res.body.toString()).toBe('done');
    expect(res.url).toBe(`http://media.test:${port}/end`);

    const err = await failure(client().request(`http://media.test:${port}/escape`));
    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it('stops after maxRedirects', async () => {
    handler = (_req, res) => res.writeHead(301, { location: '/loop' }).end();
    const err = await failure(client({ maxRedirects: 2 }).request(`http://media.test:${port}/`));
    expect(err.code).toBe('TOO_MANY_REDIRECTS');
  });

  it('does not follow redirects for POST', async () => {
    handler = (_req, res) => res.writeHead(307, { location: '/elsewhere' }).end();
    const res = await client().request(`http://media.test:${port}/hook`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(307);
  });

  it('rejects a declared Content-Length over the cap', async () => {
    handler = (_req, res) => res.writeHead(200, { 'content-length': '5000' }).end('x'.repeat(5000));
    expect((await failure(client().request(`http://media.test:${port}/`))).code).toBe('TOO_LARGE');
  });

  it('rejects a streamed body that grows over the cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      for (let i = 0; i < 20; i++) res.write('x'.repeat(100));
      res.end();
    };
    expect((await failure(client().request(`http://media.test:${port}/`))).code).toBe('TOO_LARGE');
  });

  it('times out a server that never answers, as a transient error', async () => {
    handler = () => undefined;
    const err = await failure(client({ timeoutMs: 200 }).request(`http://media.test:${port}/`));
    expect(err.code).toBe('TIMEOUT');
    expect(err.permanent).toBe(false);
  });

  it('reports a dropped connection as a transient network error', async () => {
    handler = (req) => req.socket.destroy();
    const err = await failure(client().request(`http://media.test:${port}/`));
    expect(err.code).toBe('NETWORK');
    expect(err.permanent).toBe(false);
  });
});

describe('classifyStatus', () => {
  it.each([
    [200, 'success'],
    [204, 'success'],
    [301, 'permanent'],
    [400, 'permanent'],
    [404, 'permanent'],
    [408, 'transient'],
    [409, 'transient'],
    [425, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [503, 'transient'],
  ])('%i is %s', (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });
});
