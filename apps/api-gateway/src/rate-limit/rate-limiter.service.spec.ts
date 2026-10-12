import { type ConfigService } from '@nestjs/config';
import { type Env } from '../config';
import { type RedisService } from '../redis/redis.service';
import { GCRA_LUA, GCRA_LUA_SHA } from './gcra.lua';
import { RateLimiterService } from './rate-limiter.service';

const ENV: Partial<Env> = {
  RATE_LIMIT_USER_RPS: 20,
  RATE_LIMIT_USER_BURST: 20,
  RATE_LIMIT_GLOBAL_RPS: 200,
  RATE_LIMIT_GLOBAL_BURST: 200,
  RATE_LIMIT_IP_RPS: 10,
  RATE_LIMIT_IP_BURST: 20,
  RATE_LIMIT_REPLICAS: 4,
  RATE_LIMIT_REDIS_RETRY_MS: 1000,
};

function setup() {
  const evalsha = jest.fn<Promise<unknown>, unknown[]>();
  const evalScript = jest.fn<Promise<unknown>, unknown[]>();
  const redis = { client: { evalsha, eval: evalScript } } as unknown as RedisService;
  const config = { get: (key: keyof Env) => ENV[key] } as unknown as ConfigService<Env, true>;
  return { evalsha, evalScript, limiter: new RateLimiterService(redis, config) };
}

describe('RateLimiterService', () => {
  afterEach(() => jest.useRealTimers());

  it('checks the user and the global limit in one script call', async () => {
    const { limiter, evalsha } = setup();
    evalsha.mockResolvedValue([1, 0, 19, 50_000, 199, 5_000]);

    const check = await limiter.checkUser('u1');

    expect(evalsha).toHaveBeenCalledWith(
      GCRA_LUA_SHA,
      2,
      'rl:user:u1',
      'rl:global',
      50_000,
      1_000_000,
      5_000,
      1_000_000,
    );
    expect(check).toEqual({
      allowed: true,
      retryAfterS: 0,
      limits: [
        { limit: 20, remaining: 19, resetS: 1 },
        { limit: 200, remaining: 199, resetS: 1 },
      ],
      source: 'redis',
    });
  });

  it('rounds Retry-After up to whole seconds', async () => {
    const { limiter, evalsha } = setup();
    evalsha.mockResolvedValue([0, 50_000, 0, 1_000_000, 150, 250_000]);
    await expect(limiter.checkUser('u1')).resolves.toMatchObject({
      allowed: false,
      retryAfterS: 1,
    });
  });

  it('sends the script body only when Redis does not know it', async () => {
    const { limiter, evalsha, evalScript } = setup();
    evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
    evalScript.mockResolvedValue([1, 0, 9, 100_000]);

    await expect(limiter.checkAnonymous('10.0.0.1')).resolves.toMatchObject({ allowed: true });
    expect(evalScript).toHaveBeenCalledWith(GCRA_LUA, 1, 'rl:ip:10.0.0.1', 100_000, 2_000_000);
  });

  it('falls back to a local limiter divided by the replica count', async () => {
    const { limiter, evalsha } = setup();
    evalsha.mockRejectedValue(new Error('Connection is closed.'));

    const results = [];
    for (let i = 0; i < 6; i++) results.push(await limiter.checkUser('u1'));

    // 20 rps with burst 20 over 4 replicas: a burst of 5 per replica.
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results[0]).toMatchObject({ source: 'local', limits: [{ limit: 5 }, { limit: 50 }] });
  });

  it('skips Redis for a while after a failure, then tries again', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const { limiter, evalsha } = setup();
    evalsha.mockRejectedValueOnce(new Error('Command timed out'));
    evalsha.mockResolvedValue([1, 0, 19, 50_000, 199, 5_000]);

    await limiter.checkUser('u1');
    await expect(limiter.checkUser('u1')).resolves.toMatchObject({ source: 'local' });
    expect(evalsha).toHaveBeenCalledTimes(1);

    jest.setSystemTime(1_000_000 + 1000);
    await expect(limiter.checkUser('u1')).resolves.toMatchObject({ source: 'redis' });
  });

  it('treats a malformed reply as a Redis failure', async () => {
    const { limiter, evalsha } = setup();
    evalsha.mockResolvedValue(['OK']);
    await expect(limiter.checkUser('u1')).resolves.toMatchObject({ source: 'local' });
  });
});
