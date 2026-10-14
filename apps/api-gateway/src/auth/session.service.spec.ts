import { type ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { type RedisService } from '../redis/redis.service';
import { SessionService } from './session.service';

const USER_ID = '5b0c5a8e-0000-4000-8000-000000000001';
const IDLE_S = 600;
const MAX_AGE_S = 3600;

function setup() {
  const store = new Map<string, string>();
  const client = {
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    getex: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    del: jest.fn((key: string) => Promise.resolve(store.delete(key) ? 1 : 0)),
  };
  const values: Partial<Env> = { SESSION_IDLE_TTL_S: IDLE_S, SESSION_MAX_AGE_S: MAX_AGE_S };
  const service = new SessionService(
    { client } as unknown as RedisService,
    { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>,
  );
  return { store, client, service };
}

const keyOf = (token: string) => `session:${createHash('sha256').update(token).digest('hex')}`;

describe('SessionService', () => {
  afterEach(() => jest.useRealTimers());

  it('stores the session under the hash of the token, with the idle ttl', async () => {
    const { service, store, client } = setup();
    const token = await service.create(USER_ID);

    expect(token).toMatch(/^[\w-]{43}$/);
    expect([...store.keys()]).toEqual([keyOf(token)]);
    expect(client.set).toHaveBeenCalledWith(keyOf(token), expect.any(String), 'EX', IDLE_S);
  });

  it('resolves a session and extends its idle ttl', async () => {
    const { service, client } = setup();
    const token = await service.create(USER_ID);

    await expect(service.resolve(token)).resolves.toMatchObject({ userId: USER_ID });
    expect(client.getex).toHaveBeenCalledWith(keyOf(token), 'EX', IDLE_S);
  });

  it('drops a session past its max age however active it was', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-14T10:00:00Z') });
    const { service, store } = setup();
    const token = await service.create(USER_ID);

    jest.setSystemTime(new Date('2026-10-14T11:00:01Z'));
    await expect(service.resolve(token)).resolves.toBeNull();
    expect(store.size).toBe(0);
  });

  it('treats unreadable data as no session', async () => {
    const { service, store } = setup();
    store.set(keyOf('t'), 'not json');
    await expect(service.resolve('t')).resolves.toBeNull();
  });

  it('answers 503 when Redis fails: sessions fail closed', async () => {
    const { service, client } = setup();
    client.getex.mockRejectedValue(new Error('Connection is closed.'));
    await expect(service.resolve('t')).rejects.toBeInstanceOf(RetryLaterException);
  });
});
