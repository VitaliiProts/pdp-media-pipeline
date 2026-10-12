import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type StreamName, WORKER_MAX_DELIVER } from '@pdp/contracts';
import {
  ensurePullConsumer,
  ensureStreams,
  NatsService,
  PullWorker,
  Semaphore,
} from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { type Env } from '../config';
import { resizeImage } from '../image/resize';
import { StorageService } from '../storage/storage.service';
import { ImageResizeHandler } from './image-resize.handler';

const CONSUMERS: { stream: StreamName; durable: string; filterSubject: string }[] = [
  { stream: 'JOBS_PRIORITY', durable: 'worker-priority', filterSubject: 'jobs.priority.>' },
  { stream: 'JOBS_CPU', durable: 'worker-cpu', filterSubject: 'jobs.cpu.>' },
];

@Injectable()
export class JobsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private workers: PullWorker[] = [];
  private readonly ackWaitMs: number;

  constructor(
    private readonly nats: NatsService,
    private readonly storage: StorageService,
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.ackWaitMs = config.get('WORKER_ACK_WAIT_MS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    const concurrency = this.config.get('WORKER_CONCURRENCY', { infer: true });
    const maxBytes = this.config.get('MAX_UPLOAD_BYTES', { infer: true });
    const maxInputPixels = this.config.get('MAX_INPUT_PIXELS', { infer: true });

    const handler = new ImageResizeHandler(
      {
        transition: (jobId, body) => this.metadata.transition(jobId, body),
        getObject: (key) => this.storage.getObject(key, maxBytes),
        putObject: (key, body, type) => this.storage.putObject(key, body, type),
        resize: (input, presets) => resizeImage(input, presets, { maxInputPixels }),
      },
      { workerId: this.config.get('WORKER_ID', { infer: true }), maxDeliver: WORKER_MAX_DELIVER },
    );

    const jsm = await this.nats.manager();
    await ensureStreams(
      jsm,
      CONSUMERS.map((c) => c.stream),
    );
    // One semaphore for both consumers caps CPU work per process, whichever queue it comes from.
    const semaphore = new Semaphore(concurrency);
    for (const consumer of CONSUMERS) {
      await ensurePullConsumer(jsm, {
        ...consumer,
        ackWaitMs: this.ackWaitMs,
        maxDeliver: WORKER_MAX_DELIVER,
        maxAckPending: this.config.get('WORKER_MAX_ACK_PENDING', { infer: true }),
      });
      this.workers.push(
        new PullWorker({
          name: consumer.durable,
          consumer: await this.nats.jetstream.consumers.get(consumer.stream, consumer.durable),
          handler: (msg) =>
            handler.handle({ data: msg.data, deliveryCount: msg.info.deliveryCount }),
          semaphore,
          heartbeatMs: this.ackWaitMs / 3,
        }),
      );
    }
    for (const worker of this.workers) worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.stop(this.ackWaitMs)));
  }
}
