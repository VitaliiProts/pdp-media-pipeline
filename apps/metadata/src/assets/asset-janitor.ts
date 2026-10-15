import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env } from '../config';
import { AssetsService, JANITOR_BATCH } from './assets.service';

/**
 * Deletes uploads no job has used within `ASSET_UNUSED_TTL_S`, which also releases their
 * quota. Replicas share the work through `SKIP LOCKED`; a batch that is full runs again
 * at once, so a backlog drains without waiting for the next tick.
 */
@Injectable()
export class AssetJanitor implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(AssetJanitor.name);
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly assets: AssetsService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get('ASSET_JANITOR_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.purge().finally(() => (this.running = undefined));
    }, this.intervalMs);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private async purge(): Promise<void> {
    try {
      let total = 0;
      let deleted: number;
      do {
        deleted = await this.assets.purgeUnused();
        total += deleted;
      } while (deleted === JANITOR_BATCH);
      if (total > 0) this.logger.log(`deleted ${total} unused uploads`);
    } catch (err) {
      this.logger.warn(`unused upload purge failed: ${(err as Error).message}`);
    }
  }
}
