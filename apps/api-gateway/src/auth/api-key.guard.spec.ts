import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { hashApiKey } from '@pdp/contracts';
import { type MetadataClient, MetadataError } from '@pdp/metadata-client';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { type RateLimiterService } from '../rate-limit/rate-limiter.service';
import { ApiKeyGuard } from './api-key.guard';

const USER_ID = '5b0c5a8e-0000-4000-8000-000000000001';

function context(headers: Record<string, string>) {
  const req: { userId?: string; ip: string; header: (name: string) => string | undefined } = {
    ip: '10.0.0.7',
    header: (name) => headers[name.toLowerCase()],
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { req, ctx };
}

function setup(ttlMs = 60_000) {
  const resolveApiKey = jest.fn<Promise<string | null>, [string]>();
  const metadata = { resolveApiKey } as unknown as MetadataClient;
  const checkAnonymous = jest.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 });
  const limiter = { checkAnonymous } as unknown as RateLimiterService;
  const config = { get: () => ttlMs } as unknown as ConfigService<Env, true>;
  return { resolveApiKey, checkAnonymous, guard: new ApiKeyGuard(metadata, limiter, config) };
}

describe('ApiKeyGuard', () => {
  it('rejects requests without a key', async () => {
    const { guard, resolveApiKey } = setup();
    await expect(guard.canActivate(context({}).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it('sends only the hash and attaches the user id', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    const { req, ctx } = context({ 'x-api-key': 'pdp_secret' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveApiKey).toHaveBeenCalledWith(hashApiKey('pdp_secret'));
    expect(req.userId).toBe(USER_ID);
  });

  it('rejects unknown keys', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockResolvedValue(null);
    await expect(guard.canActivate(context({ 'x-api-key': 'nope' }).ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('caches resolved keys within the ttl', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    expect(resolveApiKey).toHaveBeenCalledTimes(1);
  });

  it('resolves again after the ttl', async () => {
    const { guard, resolveApiKey } = setup(0);
    resolveApiKey.mockResolvedValue(USER_ID);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    expect(resolveApiKey).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between concurrent requests with the same key', async () => {
    const { guard, resolveApiKey, checkAnonymous } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    const requests = [1, 2, 3].map(() => context({ 'x-api-key': 'k' }));

    await Promise.all(requests.map(({ ctx }) => guard.canActivate(ctx)));

    expect(resolveApiKey).toHaveBeenCalledTimes(1);
    expect(checkAnonymous).toHaveBeenCalledTimes(1);
    expect(requests.map(({ req }) => req.userId)).toEqual([USER_ID, USER_ID, USER_ID]);
  });

  it('propagates metadata outages instead of answering 401', async () => {
    const { guard, resolveApiKey } = setup();
    resolveApiKey.mockRejectedValue(new MetadataError(0, undefined, 'timeout'));
    await expect(guard.canActivate(context({ 'x-api-key': 'k' }).ctx)).rejects.toBeInstanceOf(
      MetadataError,
    );
  });
});

describe('ApiKeyGuard rate limit for unknown keys', () => {
  it('counts Metadata lookups against the client IP', async () => {
    const { guard, resolveApiKey, checkAnonymous } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    expect(checkAnonymous).toHaveBeenCalledWith('10.0.0.7');
  });

  it('does not charge keys served from the cache', async () => {
    const { guard, resolveApiKey, checkAnonymous } = setup();
    resolveApiKey.mockResolvedValue(USER_ID);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    await guard.canActivate(context({ 'x-api-key': 'k' }).ctx);
    expect(checkAnonymous).toHaveBeenCalledTimes(1);
  });

  it('answers 429 without asking Metadata once the IP is over its limit', async () => {
    const { guard, resolveApiKey, checkAnonymous } = setup();
    checkAnonymous.mockResolvedValue({ allowed: false, retryAfterS: 3 });
    const error = await guard
      .canActivate(context({ 'x-api-key': 'guess' }).ctx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryLaterException);
    expect(error).toMatchObject({ retryAfterS: 3 });
    expect(resolveApiKey).not.toHaveBeenCalled();
  });
});
