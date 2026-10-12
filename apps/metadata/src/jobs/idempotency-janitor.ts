import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { JobsService } from './jobs.service';

const PURGE_EVERY_MS = 10 * 60_000;

/**
 * Deletes expired Idempotency-Keys. Expiry is also checked on use, so the janitor
 * only keeps the table small; running it on several replicas at once is harmless.
 */
@Injectable()
export class IdempotencyJanitor implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(IdempotencyJanitor.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly jobs: JobsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.purge(), PURGE_EVERY_MS);
    this.timer.unref();
  }

  beforeApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async purge(): Promise<void> {
    try {
      const purged = await this.jobs.purgeIdempotencyKeys();
      if (purged > 0) this.logger.log(`purged ${purged} expired idempotency keys`);
    } catch (err) {
      this.logger.warn(`idempotency key purge failed: ${(err as Error).message}`);
    }
  }
}
