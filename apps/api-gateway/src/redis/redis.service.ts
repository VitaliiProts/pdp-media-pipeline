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
      // Fail commands immediately while disconnected instead of queueing them.
      enableOfflineQueue: false,
    });
    this.client.on('error', (err) => this.logger.warn(`redis: ${err.message}`));
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
