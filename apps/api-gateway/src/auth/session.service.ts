import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { RedisService } from '../redis/redis.service';

const SessionData = z.object({ userId: z.uuid(), createdAt: z.number().int() });
export type SessionData = z.infer<typeof SessionData>;

const RETRY_AFTER_S = 5;

function parseSession(raw: string): SessionData | null {
  try {
    return SessionData.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Redis holds the hash: a dump or a `MONITOR` does not hand out working sessions. */
const sessionKey = (token: string): string =>
  `session:${createHash('sha256').update(token).digest('hex')}`;

/**
 * Sessions in Redis (ADR-013). Unlike rate limits, they fail closed: without Redis no
 * session can be checked, so browser requests get 503 while API keys keep working.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly idleTtlS: number;
  private readonly maxAgeMs: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.idleTtlS = config.get('SESSION_IDLE_TTL_S', { infer: true });
    this.maxAgeMs = config.get('SESSION_MAX_AGE_S', { infer: true }) * 1000;
  }

  /** Always a new token, so a session id planted before login is never the one that counts. */
  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const data: SessionData = { userId, createdAt: Date.now() };
    await this.run(() =>
      this.redis.client.set(sessionKey(token), JSON.stringify(data), 'EX', this.idleTtlS),
    );
    return token;
  }

  /** Extends the idle timeout; null when the session is unknown, expired or past its max age. */
  async resolve(token: string): Promise<SessionData | null> {
    const key = sessionKey(token);
    const raw = await this.run(() => this.redis.client.getex(key, 'EX', this.idleTtlS));
    if (!raw) return null;
    const session = parseSession(raw);
    if (!session || Date.now() - session.createdAt > this.maxAgeMs) {
      await this.destroy(token);
      return null;
    }
    return session;
  }

  async destroy(token: string): Promise<void> {
    await this.run(() => this.redis.client.del(sessionKey(token)));
  }

  private async run<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (err) {
      this.logger.warn(`redis unavailable, sessions cannot be checked: ${(err as Error).message}`);
      throw new RetryLaterException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'sessions are temporarily unavailable',
        RETRY_AFTER_S,
      );
    }
  }
}
