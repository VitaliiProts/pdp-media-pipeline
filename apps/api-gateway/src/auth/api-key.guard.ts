import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_KEY_HEADER, hashApiKey } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { type AuthenticatedRequest } from './user';

const MAX_CACHE_ENTRIES = 10_000;

/**
 * Resolves `X-API-Key` to a user through Metadata. Results are cached in memory
 * for a short TTL, so a revoked key keeps working for at most that long.
 *
 * A key missing from the cache costs a Metadata call, so those lookups are rate
 * limited per client IP: guessing keys must not bypass every other limit.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly cache = new Map<string, { userId: string; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly ttlMs: number;

  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly limiter: RateLimiterService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('API_KEY_CACHE_TTL_MS', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = req.header(API_KEY_HEADER);
    if (!key) throw new UnauthorizedException('missing api key');

    const hash = hashApiKey(key);
    req.userId = this.cached(hash) ?? (await this.sharedLookup(hash, req.ip ?? 'unknown'));
    return true;
  }

  /** Concurrent requests with the same uncached key share one lookup. */
  private sharedLookup(hash: string, ip: string): Promise<string> {
    let pending = this.inFlight.get(hash);
    if (!pending) {
      pending = this.lookup(hash, ip).finally(() => this.inFlight.delete(hash));
      this.inFlight.set(hash, pending);
    }
    return pending;
  }

  private cached(hash: string): string | undefined {
    const entry = this.cache.get(hash);
    return entry && entry.expiresAt > Date.now() ? entry.userId : undefined;
  }

  private async lookup(hash: string, ip: string): Promise<string> {
    const check = await this.limiter.checkAnonymous(ip);
    if (!check.allowed) {
      throw new RetryLaterException(
        HttpStatus.TOO_MANY_REQUESTS,
        'too many requests with unknown api keys',
        check.retryAfterS,
      );
    }

    const userId = await this.metadata.resolveApiKey(hash);
    if (!userId) throw new UnauthorizedException('invalid api key');

    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(hash, { userId, expiresAt: Date.now() + this.ttlMs });
    return userId;
  }
}
