import { ConfigService } from '@nestjs/config';
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
