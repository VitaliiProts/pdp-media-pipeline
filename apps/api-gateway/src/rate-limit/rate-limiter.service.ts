import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { toRetryAfterSeconds } from '../common/retry-later';
import { type Env } from '../config';
import { RedisService } from '../redis/redis.service';
import { type GcraDecision, type RateRule, toGcraLimit } from './gcra';
import { GCRA_LUA, GCRA_LUA_SHA } from './gcra.lua';
import { LocalGcra } from './local-gcra';

export interface RateCheck {
  allowed: boolean;
  /** 0 when allowed. */
  retryAfterS: number;
  /** One entry per rule, in the order the rules were given. */
  limits: { limit: number; remaining: number; resetS: number }[];
  source: 'redis' | 'local';
}

type Limit = Omit<RateRule, 'key'>;

const GLOBAL_KEY = 'rl:global';
export const userKey = (userId: string): string => `rl:user:${userId}`;
export const ipKey = (ip: string): string => `rl:ip:${ip}`;

/**
 * GCRA in Redis, falling back to an in-process GCRA when Redis fails or is slow
 * (ADR-005). After a failure Redis is skipped for a while, so requests do not
 * each wait for the command timeout.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly local = new LocalGcra();
  private readonly user: Limit;
  private readonly global: Limit;
  private readonly ip: Limit;
  private readonly replicas: number;
  private readonly redisRetryMs: number;
  private redisRetryAt = 0;
  private degraded = false;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    const get = <K extends keyof Env>(key: K): Env[K] => config.get(key, { infer: true });
    this.user = { ratePerSec: get('RATE_LIMIT_USER_RPS'), burst: get('RATE_LIMIT_USER_BURST') };
    this.global = {
      ratePerSec: get('RATE_LIMIT_GLOBAL_RPS'),
      burst: get('RATE_LIMIT_GLOBAL_BURST'),
    };
    this.ip = { ratePerSec: get('RATE_LIMIT_IP_RPS'), burst: get('RATE_LIMIT_IP_BURST') };
    this.replicas = get('RATE_LIMIT_REPLICAS');
    this.redisRetryMs = get('RATE_LIMIT_REDIS_RETRY_MS');
  }

  /** The user's limit comes first, so headers can describe the one the client controls. */
  checkUser(userId: string): Promise<RateCheck> {
    return this.check([
      { key: userKey(userId), ...this.user },
      { key: GLOBAL_KEY, ...this.global },
    ]);
  }

  checkAnonymous(ip: string): Promise<RateCheck> {
    return this.check([{ key: ipKey(ip), ...this.ip }]);
  }

  async check(rules: readonly RateRule[]): Promise<RateCheck> {
    if (Date.now() >= this.redisRetryAt) {
      try {
        const decision = await this.checkInRedis(rules);
        this.markRecovered();
        return toRateCheck(rules, decision, 'redis');
      } catch (err) {
        this.markDegraded(err);
      }
    }
    const scaled = rules.map((rule) => ({
      ...rule,
      ratePerSec: rule.ratePerSec / this.replicas,
      burst: Math.max(1, Math.floor(rule.burst / this.replicas)),
    }));
    const decision = this.local.check(
      scaled.map((rule) => rule.key),
      scaled.map(toGcraLimit),
    );
    return toRateCheck(scaled, decision, 'local');
  }

  private async checkInRedis(rules: readonly RateRule[]): Promise<GcraDecision> {
    const keys = rules.map((rule) => rule.key);
    const args = rules.flatMap((rule) => {
      const { intervalUs, toleranceUs } = toGcraLimit(rule);
      return [intervalUs, toleranceUs];
    });
    const reply = z
      .array(z.number())
      .length(2 + 2 * rules.length)
      .parse(await this.evalGcra(keys, args));
    const [allowed, retryAfterUs] = reply;
    return {
      allowed: allowed === 1,
      retryAfterUs: retryAfterUs ?? 0,
      limits: rules.map((_, i) => ({
        remaining: reply[2 + 2 * i] ?? 0,
        resetUs: reply[3 + 2 * i] ?? 0,
      })),
      newTats: [],
    };
  }

  /** EVALSHA first; the script body is sent only when Redis does not have it cached. */
  private async evalGcra(keys: string[], args: number[]): Promise<unknown> {
    const { client } = this.redis;
    try {
      return await client.evalsha(GCRA_LUA_SHA, keys.length, ...keys, ...args);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('NOSCRIPT')) throw err;
      return client.eval(GCRA_LUA, keys.length, ...keys, ...args);
    }
  }

  private markDegraded(err: unknown): void {
    this.redisRetryAt = Date.now() + this.redisRetryMs;
    if (this.degraded) return;
    this.degraded = true;
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.warn(`redis unavailable, rate limits are local to this replica: ${reason}`);
  }

  private markRecovered(): void {
    if (!this.degraded) return;
    this.degraded = false;
    this.logger.log('redis is back, rate limits are shared again');
  }
}

function toRateCheck(
  rules: readonly RateRule[],
  decision: GcraDecision,
  source: RateCheck['source'],
): RateCheck {
  return {
    allowed: decision.allowed,
    retryAfterS: decision.allowed ? 0 : toRetryAfterSeconds(decision.retryAfterUs),
    limits: rules.map((rule, i) => {
      const state = decision.limits[i];
      return {
        limit: rule.burst,
        remaining: state?.remaining ?? 0,
        resetS: Math.ceil((state?.resetUs ?? 0) / 1_000_000),
      };
    }),
    source,
  };
}
