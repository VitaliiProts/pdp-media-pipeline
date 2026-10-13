import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dispatchSubject, type JobClass, STREAM_BY_CLASS, type StreamName } from '@pdp/contracts';
import {
  ensurePullConsumer,
  ensureStreams,
  NatsService,
  PullWorker,
  Semaphore,
} from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { JobRunner, ObjectStorage, SourceFetcher } from '@pdp/worker-kit';
import { type Env, type VideoJobType } from '../config';
import { Ffmpeg } from '../ffmpeg/ffmpeg';
import { type ProbeLimits } from '../ffmpeg/probe';
import { VideoFramesProcessor } from '../frames/video-frames.processor';
import { VideoTranscodeProcessor } from '../transcode/video-transcode.processor';

interface ConsumerSpec {
  stream: StreamName;
  durable: string;
  filterSubject: string;
}

/** `video.frames` keeps the names it had before transcoding existed. */
const DURABLE_PREFIX: Record<VideoJobType, string> = {
  'video.frames': 'video',
  'video.transcode': 'video-transcode',
};
const VIDEO_CLASSES: readonly JobClass[] = ['priority', 'cpu'];

/**
 * The image worker consumes `*.image.resize` from the same work-queue streams; filters of
 * consumers on one work-queue stream must not overlap, so each type gets its own subject.
 */
const consumersOf = (type: VideoJobType): ConsumerSpec[] =>
  VIDEO_CLASSES.map((jobClass) => ({
    stream: STREAM_BY_CLASS[jobClass],
    durable: `${DURABLE_PREFIX[type]}-${jobClass}`,
    filterSubject: dispatchSubject(jobClass, type),
  }));

@Injectable()
export class JobsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
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
    const types = this.config.get('VIDEO_JOB_TYPES', { infer: true });
    const runner = this.createRunner(types);

    const consumers = types.flatMap(consumersOf);
    const jsm = await this.nats.manager();
    await ensureStreams(jsm, [...new Set(consumers.map((c) => c.stream))]);
    const semaphore = new Semaphore(this.config.get('VIDEO_CONCURRENCY', { infer: true }));
    for (const consumer of consumers) {
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
          handler: (msg, signal) =>
            runner.handle(
              {
                data: msg.data,
                deliveryCount: msg.info.deliveryCount,
                consumer: consumer.durable,
              },
              signal,
            ),
          semaphore,
          heartbeatMs: this.ackWaitMs / 3,
        }),
      );
    }
    for (const worker of this.workers) worker.start();
    this.logger.log(`consuming ${types.join(', ')}`);
  }

  async beforeApplicationShutdown(): Promise<void> {
    const graceMs = this.config.get('WORKER_SHUTDOWN_GRACE_MS', { infer: true });
    await Promise.all(this.workers.map((w) => w.stop(graceMs)));
  }

  private createRunner(types: readonly VideoJobType[]): JobRunner {
    const ffmpeg = new Ffmpeg({
      ffmpegPath: this.config.get('FFMPEG_PATH', { infer: true }),
      ffprobePath: this.config.get('FFPROBE_PATH', { infer: true }),
      timeoutMs: this.config.get('FFMPEG_TIMEOUT_MS', { infer: true }),
      transcodeTimeoutMs: this.config.get('TRANSCODE_TIMEOUT_MS', { infer: true }),
    });
    const maxDimension = this.config.get('VIDEO_MAX_DIMENSION', { infer: true });
    const limits = (maxDurationSeconds: number): ProbeLimits => ({
      maxDurationSeconds,
      maxDimension,
    });
    const source = {
      maxSourceBytes: this.config.get('MAX_VIDEO_BYTES', { infer: true }),
      downloadTimeoutMs: this.config.get('VIDEO_DOWNLOAD_TIMEOUT_MS', { infer: true }),
      workDir: this.config.get('VIDEO_WORK_DIR', { infer: true }),
    };
    const shared = {
      download: this.sources.download.bind(this.sources),
      extractPreview: ffmpeg.extractPreview.bind(ffmpeg),
      putObject: this.storage.putObject.bind(this.storage),
    };

    const runner = new JobRunner(
      {
        transition: (jobId, body) => this.metadata.transition(jobId, body),
        progress: (jobId, body) => this.metadata.reportProgress(jobId, body),
      },
      {
        workerId: this.config.get('WORKER_ID', { infer: true }),
        retry: {
          baseMs: this.config.get('WORKER_RETRY_BASE_MS', { infer: true }),
          maxMs: this.config.get('WORKER_RETRY_MAX_MS', { infer: true }),
        },
        progressIntervalMs: this.config.get('JOB_PROGRESS_INTERVAL_MS', { infer: true }),
      },
    );

    if (types.includes('video.frames')) {
      const frameLimits = limits(this.config.get('VIDEO_MAX_DURATION_SECONDS', { infer: true }));
      runner.register(
        new VideoFramesProcessor(
          {
            ...shared,
            probe: (path) => ffmpeg.probe(path, frameLimits),
            extractFrames: ffmpeg.extractFrames.bind(ffmpeg),
          },
          source,
        ),
      );
    }
    if (types.includes('video.transcode')) {
      const transcodeLimits = limits(
        this.config.get('TRANSCODE_MAX_DURATION_SECONDS', { infer: true }),
      );
      runner.register(
        new VideoTranscodeProcessor(
          {
            ...shared,
            probe: (path) => ffmpeg.probe(path, transcodeLimits),
            probeOutput: (path) => ffmpeg.probe(path, transcodeLimits),
            transcode: ffmpeg.transcode.bind(ffmpeg),
            uploadFile: this.storage.uploadFile.bind(this.storage),
          },
          source,
        ),
      );
    }
    return runner;
  }
}
