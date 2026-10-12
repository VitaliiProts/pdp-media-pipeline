import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type StreamName } from '@pdp/contracts';
import {
  ensurePullConsumer,
  ensureStreams,
  NatsService,
  PullWorker,
  Semaphore,
} from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { JobRunner, ObjectStorage, SourceFetcher } from '@pdp/worker-kit';
import { type Env } from '../config';
import { Ffmpeg } from '../ffmpeg/ffmpeg';
import { VideoFramesProcessor } from '../frames/video-frames.processor';

/**
 * The image worker consumes `*.image.resize` from the same work-queue streams; filters of
 * consumers on one work-queue stream must not overlap.
 */
const CONSUMERS: { stream: StreamName; durable: string; filterSubject: string }[] = [
  {
    stream: 'JOBS_PRIORITY',
    durable: 'video-priority',
    filterSubject: 'jobs.priority.video.frames',
  },
  { stream: 'JOBS_CPU', durable: 'video-cpu', filterSubject: 'jobs.cpu.video.frames' },
];

@Injectable()
export class JobsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private workers: PullWorker[] = [];
  private readonly ackWaitMs: number;

  constructor(
    private readonly nats: NatsService,
    private readonly storage: ObjectStorage,
    private readonly sources: SourceFetcher,
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.ackWaitMs = config.get('WORKER_ACK_WAIT_MS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    const ffmpeg = new Ffmpeg({
      ffmpegPath: this.config.get('FFMPEG_PATH', { infer: true }),
      ffprobePath: this.config.get('FFPROBE_PATH', { infer: true }),
      timeoutMs: this.config.get('FFMPEG_TIMEOUT_MS', { infer: true }),
      limits: {
        maxDurationSeconds: this.config.get('VIDEO_MAX_DURATION_SECONDS', { infer: true }),
        maxDimension: this.config.get('VIDEO_MAX_DIMENSION', { infer: true }),
      },
    });
    const runner = new JobRunner(
      { transition: (jobId, body) => this.metadata.transition(jobId, body) },
      {
        workerId: this.config.get('WORKER_ID', { infer: true }),
        retry: {
          baseMs: this.config.get('WORKER_RETRY_BASE_MS', { infer: true }),
          maxMs: this.config.get('WORKER_RETRY_MAX_MS', { infer: true }),
        },
      },
    ).register(
      new VideoFramesProcessor(
        {
          download: (source, path, limits) => this.sources.download(source, path, limits),
          probe: (path) => ffmpeg.probe(path),
          extractFrames: (source, dir, interval, max) =>
            ffmpeg.extractFrames(source, dir, interval, max),
          extractPreview: (source, output, at) => ffmpeg.extractPreview(source, output, at),
          putObject: (key, body, type) => this.storage.putObject(key, body, type),
        },
        {
          maxSourceBytes: this.config.get('MAX_VIDEO_BYTES', { infer: true }),
          downloadTimeoutMs: this.config.get('VIDEO_DOWNLOAD_TIMEOUT_MS', { infer: true }),
          workDir: this.config.get('VIDEO_WORK_DIR', { infer: true }),
        },
      ),
    );

    const jsm = await this.nats.manager();
    await ensureStreams(
      jsm,
      CONSUMERS.map((c) => c.stream),
    );
    const semaphore = new Semaphore(this.config.get('VIDEO_CONCURRENCY', { infer: true }));
    for (const consumer of CONSUMERS) {
      await ensurePullConsumer(jsm, {
        ...consumer,
        ackWaitMs: this.ackWaitMs,
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
