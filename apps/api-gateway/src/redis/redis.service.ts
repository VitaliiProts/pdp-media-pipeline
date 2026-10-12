import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { type Env } from '../config';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 1,
      // Fail commands immediately while disconnected instead of queueing them,
      // and give up on a hanging Redis before it eats the request's latency budget.
      enableOfflineQueue: false,
      commandTimeout: config.get('REDIS_COMMAND_TIMEOUT_MS', { infer: true }),
    });
    this.client.on('error', (err) => this.logger.warn(`redis: ${err.message}`));
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // A hung Redis must not block shutdown; drop the socket instead.
      this.client.disconnect();
    }
  }
}
