import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_KEY_HEADER, hashApiKey } from '@pdp/contracts';
import { MetadataClient } from '@pdp/metadata-client';
import { type Request } from 'express';
import { type Env } from '../config';

interface AuthenticatedRequest extends Request {
  userId?: string;
}

const MAX_CACHE_ENTRIES = 10_000;

/**
 * Resolves `X-API-Key` to a user through Metadata. Results are cached in memory
 * for a short TTL, so a revoked key keeps working for at most that long.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly cache = new Map<string, { userId: string; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('API_KEY_CACHE_TTL_MS', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = req.header(API_KEY_HEADER);
    if (!key) throw new UnauthorizedException('missing api key');

    req.userId = await this.resolve(hashApiKey(key));
    return true;
  }

  private async resolve(hash: string): Promise<string> {
    const cached = this.cache.get(hash);
    if (cached && cached.expiresAt > Date.now()) return cached.userId;

    const userId = await this.metadata.resolveApiKey(hash);
    if (!userId) throw new UnauthorizedException('invalid api key');

    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(hash, { userId, expiresAt: Date.now() + this.ttlMs });
    return userId;
  }
}

export const UserId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const userId = context.switchToHttp().getRequest<AuthenticatedRequest>().userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
});
