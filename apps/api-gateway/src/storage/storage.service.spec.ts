import { ConfigService } from '@nestjs/config';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { type AddressInfo, type Socket } from 'node:net';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { PRESIGN_BUCKET_S, StorageService } from './storage.service';

const TTL_S = 3600;

/** `X-Amz-Date` (`20261015T120000Z`) plus `X-Amz-Expires`, in ms. */
function validUntil(url: string): number {
  const params = new URL(url).searchParams;
  const signedAt = (params.get('X-Amz-Date') ?? '').replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z',
  );
  return Date.parse(signedAt) + Number(params.get('X-Amz-Expires')) * 1000;
}

describe('presigned GET links', () => {
  const storage = new StorageService(
    new ConfigService<Env, true>({
      S3_BUCKET: 'media',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    }),
  );
  afterAll(() => storage.onApplicationShutdown());
  afterEach(() => jest.useRealTimers());

  const at = (iso: string) => {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'],
    });
  };

  it('repeats the same link within a time bucket and a new one after it', async () => {
    at('2026-10-15T12:00:10.000Z');
    const first = await storage.presignGet('u/1/harbour', TTL_S, { downloadName: 'harbour.jpg' });
    jest.setSystemTime(new Date('2026-10-15T12:04:59.999Z'));
    const same = await storage.presignGet('u/1/harbour', TTL_S, { downloadName: 'harbour.jpg' });
    jest.setSystemTime(new Date('2026-10-15T12:05:00.000Z'));
    const next = await storage.presignGet('u/1/harbour', TTL_S, { downloadName: 'harbour.jpg' });

    expect(PRESIGN_BUCKET_S).toBe(300);
    expect(same).toBe(first);
    expect(next).not.toBe(first);
    expect(new URL(first).searchParams.get('response-content-disposition')).toBe(
      "attachment; filename*=UTF-8''harbour.jpg",
    );
  });

  it('stays valid at least as long as asked, wherever in the bucket it is signed', async () => {
    for (const now of ['2026-10-15T12:05:00.000Z', '2026-10-15T12:09:59.999Z']) {
      at(now);
      const url = await storage.presignGet('u/1/harbour', TTL_S);
      expect(validUntil(url)).toBeGreaterThanOrEqual(Date.parse(now) + TTL_S * 1000);
    }
  });
});

describe('when storage is unreachable', () => {
  const sockets = new Set<Socket>();
  // Accepts connections and never answers, like a partitioned MinIO.
  const silent = createServer().on('connection', (socket) => sockets.add(socket));
  let silentUrl: string;
  let closedUrl: string;

  const storageAt = (endpoint: string) =>
    new StorageService(
      new ConfigService<Env, true>({
        S3_BUCKET: 'media',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: true,
        S3_ACCESS_KEY: 'key',
        S3_SECRET_KEY: 'secret',
        S3_ENDPOINT: endpoint,
        S3_TIMEOUT_MS: 300,
      }),
    );

  beforeAll(async () => {
    silent.listen(0, '127.0.0.1');
    await once(silent, 'listening');
    silentUrl = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    const closed = createServer().listen(0, '127.0.0.1');
    await once(closed, 'listening');
    closedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    closed.close();
  });

  afterAll(() => {
    for (const socket of sockets) socket.destroy();
    silent.close();
  });

  it.each([
    ['does not answer', () => silentUrl],
    ['refuses the connection', () => closedUrl],
  ])('asks to retry later when it %s', async (_, url) => {
    const storage = storageAt(url());
    const started = Date.now();

    const err: unknown = await storage.headObject('uploads/u1/a.jpg').catch((e: unknown) => e);

    storage.onApplicationShutdown();
    expect(err).toBeInstanceOf(RetryLaterException);
    expect((err as RetryLaterException).getStatus()).toBe(503);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('in AWS, without an endpoint and keys', () => {
  const saved = { ...process.env };
  let storage: StorageService;

  beforeAll(() => {
    // The default chain reads these first; in EKS the pod's role takes their place.
    process.env.AWS_ACCESS_KEY_ID = 'AKIAPODROLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    delete process.env.AWS_PROFILE;
    storage = new StorageService(
      new ConfigService<Env, true>({
        S3_BUCKET: 'pdp-media-186712718120',
        S3_REGION: 'eu-central-1',
        S3_FORCE_PATH_STYLE: false,
      }),
    );
  });
  afterAll(() => {
    storage.onApplicationShutdown();
    process.env = saved;
  });

  it('signs links for the regional S3 host with credentials the SDK found itself', async () => {
    const url = new URL(await storage.presignPut('uploads/u1/a.jpg', 'image/jpeg', 10, 600));

    expect(url.host).toBe('pdp-media-186712718120.s3.eu-central-1.amazonaws.com');
    expect(url.pathname).toBe('/uploads/u1/a.jpg');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /^AKIAPODROLE\/\d{8}\/eu-central-1\/s3\/aws4_request$/,
    );
  });
});
