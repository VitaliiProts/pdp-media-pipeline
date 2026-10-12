import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { RetryLaterException } from '../common/retry-later';
import { RateLimitGuard } from './rate-limit.guard';
import { type RateCheck, type RateLimiterService } from './rate-limiter.service';

function setup(check: RateCheck, { userId }: { userId?: string } = { userId: 'u1' }) {
  const headers: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => (headers[name] = value) };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ userId }), getResponse: () => res }),
  } as unknown as ExecutionContext;
  const checkUser = jest.fn().mockResolvedValue(check);
  const guard = new RateLimitGuard({ checkUser } as unknown as RateLimiterService);
  return { guard, ctx, headers, checkUser };
}

const limits = [
  { limit: 20, remaining: 7, resetS: 1 },
  { limit: 200, remaining: 150, resetS: 1 },
];

describe('RateLimitGuard', () => {
  it('passes and describes the user limit in RateLimit headers', async () => {
    const { guard, ctx, headers, checkUser } = setup({
      allowed: true,
      retryAfterS: 0,
      limits,
      source: 'redis',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(checkUser).toHaveBeenCalledWith('u1');
    expect(headers).toEqual({
      'RateLimit-Limit': '20',
      'RateLimit-Remaining': '7',
      'RateLimit-Reset': '1',
    });
  });

  it('refuses with 429 and the wait in seconds', async () => {
    const { guard, ctx, headers } = setup({
      allowed: false,
      retryAfterS: 2,
      limits: [{ limit: 20, remaining: 0, resetS: 1 }, limits[1]!],
      source: 'redis',
    });

    const error = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryLaterException);
    expect(error).toMatchObject({ retryAfterS: 2 });
    expect((error as RetryLaterException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(headers['RateLimit-Remaining']).toBe('0');
  });

  it('fails loudly when it runs before authentication', async () => {
    const { guard, ctx } = setup({ allowed: true, retryAfterS: 0, limits, source: 'redis' }, {});
    await expect(guard.canActivate(ctx)).rejects.toThrow('after ApiKeyGuard');
  });
});
