import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type StreamName } from '@pdp/contracts';
import { EgressClient } from '@pdp/egress';
import {
  ensurePullConsumer,
  ensureStreams,
  NatsService,
  PullWorker,
  Semaphore,
} from '@pdp/messaging';
import { MetadataClient, MetadataError } from '@pdp/metadata-client';
import { JobRunner, ObjectStorage, SourceFetcher } from '@pdp/worker-kit';
import { type Env } from '../config';
import { ImageResizeProcessor } from '../image/image-resize.processor';
import { resizeImage } from '../image/resize';
import { WebhookDeliverProcessor } from '../webhooks/webhook-deliver.processor';

type Pool = 'cpu' | 'io';

/**
 * Work-queue streams reject consumers with overlapping filters, so each consumer names the
 * job types it handles; `video.frames` on the same streams belongs to the video worker.
 */
const CONSUMERS: { stream: StreamName; durable: string; filterSubject: string; pool: Pool }[] = [
  {
    stream: 'JOBS_PRIORITY',
    durable: 'worker-priority',
    filterSubject: 'jobs.priority.image.resize',
    pool: 'cpu',
  },
  {
    stream: 'JOBS_CPU',
    durable: 'worker-cpu',
    filterSubject: 'jobs.cpu.image.resize',
    pool: 'cpu',
  },
  {
    stream: 'JOBS_IO',
    durable: 'worker-io',
    filterSubject: 'jobs.io.webhook.deliver',
    pool: 'io',
  },
];

@Injectable()
export class JobsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private workers: PullWorker[] = [];
  private readonly ackWaitMs: number;

  constructor(
    private readonly nats: NatsService,
    private readonly storage: ObjectStorage,
    private readonly sources: SourceFetcher,
    private readonly egress: EgressClient,
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.ackWaitMs = config.get('WORKER_ACK_WAIT_MS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    const maxInputPixels = this.config.get('MAX_INPUT_PIXELS', { infer: true });
    const runner = new JobRunner(
      { transition: (jobId, body) => this.metadata.transition(jobId, body) },
      {
        workerId: this.config.get('WORKER_ID', { infer: true }),
        retry: {
          baseMs: this.config.get('WORKER_RETRY_BASE_MS', { infer: true }),
          maxMs: this.config.get('WORKER_RETRY_MAX_MS', { infer: true }),
        },
      },
    )
      .register(
        new ImageResizeProcessor(
          {
            fetchSource: (source, limits) => this.sources.fetch(source, limits),
            putObject: (key, body, type) => this.storage.putObject(key, body, type),
            resize: (input, presets) => resizeImage(input, presets, { maxInputPixels }),
          },
          this.config.get('MAX_UPLOAD_BYTES', { infer: true }),
        ),
      )
      .register(
        new WebhookDeliverProcessor(
          {
            getEndpoint: (id) => this.webhookEndpoint(id),
            request: (url, req) => this.egress.request(url, req),
          },
          { timeoutMs: this.config.get('WEBHOOK_TIMEOUT_MS', { infer: true }) },
        ),
      );

    const jsm = await this.nats.manager();
    await ensureStreams(
      jsm,
      CONSUMERS.map((c) => c.stream),
    );
    // cpu and priority share one pool, which caps CPU work per process whichever queue it
    // comes from; webhook deliveries mostly wait on the network and must not hold CPU slots.
    const pools: Record<Pool, Semaphore> = {
      cpu: new Semaphore(this.config.get('WORKER_CONCURRENCY', { infer: true })),
      io: new Semaphore(this.config.get('WEBHOOK_CONCURRENCY', { infer: true })),
    };
    for (const { pool, ...consumer } of CONSUMERS) {
      await ensurePullConsumer(jsm, {
        ...consumer,
        ackWaitMs: this.ackWaitMs,
        // Metadata decides when a job is out of attempts; NATS keeps redelivering until then.
        maxDeliver: -1,
        maxAckPending: this.config.get('WORKER_MAX_ACK_PENDING', { infer: true }),
      });
      this.workers.push(
        new PullWorker({
          name: consumer.durable,
          consumer: await this.nats.jetstream.consumers.get(consumer.stream, consumer.durable),
          handler: (msg) =>
            runner.handle({
              data: msg.data,
              deliveryCount: msg.info.deliveryCount,
              consumer: consumer.durable,
            }),
          semaphore: pools[pool],
          heartbeatMs: this.ackWaitMs / 3,
        }),
      );
    }
    for (const worker of this.workers) worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.stop(this.ackWaitMs)));
  }

  private async webhookEndpoint(id: string) {
    try {
      return await this.metadata.getWebhookEndpoint(id);
    } catch (err) {
      if (err instanceof MetadataError && err.code === 'WEBHOOK_NOT_FOUND') return null;
      throw err;
    }
  }
}
