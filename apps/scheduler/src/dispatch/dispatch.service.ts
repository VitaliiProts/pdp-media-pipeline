import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobCreatedV1 } from '@pdp/contracts';
import {
  ensurePullConsumer,
  ensureStreams,
  NatsService,
  PullWorker,
  Semaphore,
} from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { type Env } from '../config';
import { JobCreatedHandler } from './job-created.handler';

const DURABLE = 'scheduler';
const ACK_WAIT_MS = 30_000;

@Injectable()
export class DispatchService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private worker?: PullWorker;

  constructor(
    private readonly nats: NatsService,
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const jsm = await this.nats.manager();
    await ensureStreams(jsm, ['EVENTS', 'JOBS_CPU', 'JOBS_IO', 'JOBS_PRIORITY']);
    await ensurePullConsumer(jsm, {
      stream: 'EVENTS',
      durable: DURABLE,
      filterSubject: JobCreatedV1.subject,
      ackWaitMs: ACK_WAIT_MS,
      maxDeliver: 10,
      maxAckPending: 100,
    });

    const handler = new JobCreatedHandler({
      publish: (subject, data, msgId) => this.nats.publishJson(subject, data, msgId),
      transition: (jobId, body) => this.metadata.transition(jobId, body),
    });
    this.worker = new PullWorker({
      name: DURABLE,
      consumer: await this.nats.jetstream.consumers.get('EVENTS', DURABLE),
      handler: (msg) => handler.handle(msg.data),
      semaphore: new Semaphore(this.config.get('SCHEDULER_CONCURRENCY', { infer: true })),
      heartbeatMs: ACK_WAIT_MS / 3,
    });
    this.worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.stop(10_000);
  }
}
