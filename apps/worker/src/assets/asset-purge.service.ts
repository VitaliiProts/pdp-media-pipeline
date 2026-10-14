import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetDeletedV1 } from '@pdp/contracts';
import {
  ensurePullConsumer,
  ensureStreams,
  NatsService,
  PullWorker,
  Semaphore,
} from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { ObjectStorage } from '@pdp/worker-kit';
import { type Env } from '../config';
import { AssetPurgeHandler } from './asset-purge.handler';

const DURABLE = 'asset-purge';
const ACK_WAIT_MS = 60_000;
const CONCURRENCY = 2;

/**
 * Deleting objects is IO work, so it runs where webhook deliveries run: in the `io`
 * deployment in the cluster, in the single worker in compose.
 */
@Injectable()
export class AssetPurgeService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(AssetPurgeService.name);
  private worker?: PullWorker;

  constructor(
    private readonly nats: NatsService,
    private readonly storage: ObjectStorage,
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_CLASSES', { infer: true }).includes('io')) return;

    const jsm = await this.nats.manager();
    await ensureStreams(jsm, ['EVENTS']);
    await ensurePullConsumer(jsm, {
      stream: 'EVENTS',
      durable: DURABLE,
      filterSubject: AssetDeletedV1.subject,
      ackWaitMs: ACK_WAIT_MS,
      // Storage outages are retried until they pass; an invalid event is terminated instead.
      maxDeliver: -1,
      maxAckPending: 16,
    });

    const handler = new AssetPurgeHandler({
      listJobIds: async (userId, assetId, limit, cursor) => {
        const page = await this.metadata.listJobs({ userId, assetId, limit, cursor });
        return { ids: page.items.map((job) => job.id), nextCursor: page.nextCursor };
      },
      deleteObject: (key) => this.storage.deleteObject(key),
      deletePrefix: (prefix) => this.storage.deletePrefix(prefix),
    });
    this.worker = new PullWorker({
      name: DURABLE,
      consumer: await this.nats.jetstream.consumers.get('EVENTS', DURABLE),
      handler: (msg) => handler.handle(msg.data),
      semaphore: new Semaphore(CONCURRENCY),
      heartbeatMs: ACK_WAIT_MS / 3,
    });
    this.worker.start();
    this.logger.log(`consuming ${DURABLE}`);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.stop(this.config.get('WORKER_SHUTDOWN_GRACE_MS', { infer: true }));
  }
}
