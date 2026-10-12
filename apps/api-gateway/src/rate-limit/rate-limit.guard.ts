import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { type Response } from 'express';
import { type AuthenticatedRequest } from '../auth/api-key.guard';
import { RetryLaterException } from '../common/retry-later';
import { RateLimiterService } from './rate-limiter.service';

/**
 * Per-user and global limit. Runs after `ApiKeyGuard`, which sets the user.
 * `RateLimit-*` describe the user's own limit, the one the client can act on.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const { userId } = http.getRequest<AuthenticatedRequest>();
    if (!userId) throw new Error('RateLimitGuard must run after ApiKeyGuard');

    const check = await this.limiter.checkUser(userId);
    const user = check.limits[0];
    if (user) {
      const res = http.getResponse<Response>();
      res.setHeader('RateLimit-Limit', String(user.limit));
      res.setHeader('RateLimit-Remaining', String(user.remaining));
      res.setHeader('RateLimit-Reset', String(user.resetS));
    }
    if (!check.allowed) {
      throw new RetryLaterException(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate limit exceeded',
        check.retryAfterS,
      );
    }
    return true;
  }
}
