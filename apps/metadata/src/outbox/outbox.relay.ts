import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ensureStreams, NatsService } from '@pdp/messaging';
import { jobMetrics, withStoredTraceContext } from '@pdp/observability';
import { asc, inArray, isNull } from 'drizzle-orm';
import { type Env } from '../config';
import { PostgresService } from '../database/postgres.service';
import { outbox } from '../database/schema';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A publish failure that is already logged with the event's trace and job. */
class PublishFailed extends Error {}

/**
 * Publishes committed outbox rows to NATS with `Nats-Msg-Id = eventId`.
 * `SKIP LOCKED` lets several replicas share the table without publishing a row twice
 * concurrently; a crash between publish and commit republishes, and JetStream dedups it.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly pollMs: number;
  private readonly batch: number;
  private stopped = false;
  private loop?: Promise<void>;

  constructor(
    private readonly pg: PostgresService,
    private readonly nats: NatsService,
    config: ConfigService<Env, true>,
  ) {
    this.pollMs = config.get('OUTBOX_POLL_MS', { infer: true });
    this.batch = config.get('OUTBOX_BATCH', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await ensureStreams(await this.nats.manager(), ['EVENTS', 'JOBS_DLQ']);
    this.loop = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.loop;
  }

  /** Publishes one batch; returns how many rows were published. */
  async publishBatch(): Promise<number> {
    return this.pg.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outbox)
        .where(isNull(outbox.publishedAt))
        .orderBy(asc(outbox.createdAt))
        .limit(this.batch)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return 0;

      for (const row of rows) {
        const ack = await withStoredTraceContext(row.traceContext, async () => {
          try {
            return await this.nats.publishJson(row.subject, row.payload, row.id);
          } catch (err) {
            const message = `relay failed on ${row.subject} ${row.id}: ${(err as Error).message}`;
            this.logger.error(message);
            throw new PublishFailed(message, { cause: err });
          }
        });
        if (ack.duplicate) jobMetrics.duplicate('outbox');
      }
      await tx
        .update(outbox)
        .set({ publishedAt: new Date() })
        .where(
          inArray(
            outbox.id,
            rows.map((r) => r.id),
          ),
        );
      return rows.length;
    });
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const published = await this.publishBatch();
        if (published < this.batch) await sleep(this.pollMs);
      } catch (err) {
        if (!(err instanceof PublishFailed)) {
          this.logger.error(`relay failed: ${(err as Error).message}`);
        }
        await sleep(1000);
      }
    }
  }
}
