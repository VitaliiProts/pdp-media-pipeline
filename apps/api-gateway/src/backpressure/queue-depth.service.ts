import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type JobClass, STREAM_BY_CLASS } from '@pdp/contracts';
import { NatsService, streamDepth } from '@pdp/messaging';
import { type Env } from '../config';

type Depths = Record<JobClass, number>;

/** Past this age a snapshot says too little about the queue to refuse work on it. */
const MAX_STALENESS_FACTOR = 10;

/**
 * Depth of every class stream, cached for `QUEUE_DEPTH_CACHE_MS`. Requests never
 * wait for NATS once a snapshot exists: a stale one is served while one refresh
 * runs in the background, however many requests arrive meanwhile.
 */
@Injectable()
export class QueueDepthService {
  private readonly logger = new Logger(QueueDepthService.name);
  private readonly ttlMs: number;
  private snapshot: { depths: Depths; takenAt: number } | null = null;
  private refreshing: Promise<void> | null = null;
  private failing = false;

  constructor(
    private readonly nats: NatsService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('QUEUE_DEPTH_CACHE_MS', { infer: true });
  }

  /** `null` when the depth is unknown: NATS has not answered recently enough. */
  async depthOf(jobClass: JobClass): Promise<number | null> {
    const now = Date.now();
    if (!this.snapshot) await this.refresh();
    else if (now - this.snapshot.takenAt >= this.ttlMs) void this.refresh();

    const snapshot = this.snapshot;
    if (!snapshot || now - snapshot.takenAt > this.ttlMs * MAX_STALENESS_FACTOR) return null;
    return snapshot.depths[jobClass];
  }

  private refresh(): Promise<void> {
    this.refreshing ??= this.load()
      .then((depths) => {
        this.snapshot = { depths, takenAt: Date.now() };
        if (this.failing) this.logger.log('queue depth is readable again');
        this.failing = false;
      })
      .catch((err: unknown) => {
        if (!this.failing) {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(`cannot read queue depth, not shedding load: ${reason}`);
        }
        this.failing = true;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async load(): Promise<Depths> {
    const jsm = await this.nats.manager();
    const depth = (jobClass: JobClass) => streamDepth(jsm, STREAM_BY_CLASS[jobClass]);
    const [io, cpu, priority] = await Promise.all([depth('io'), depth('cpu'), depth('priority')]);
    return { io, cpu, priority };
  }
}
