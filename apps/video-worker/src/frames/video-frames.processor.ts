import {
  type MediaSource,
  mediaSourceOf,
  videoFrameKey,
  VideoFramesInputV1,
  type VideoFramesOutputV1,
} from '@pdp/contracts';
import {
  type FetchLimits,
  type JobContext,
  type JobProcessor,
  PermanentError,
} from '@pdp/worker-kit';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type VideoProbe } from '../ffmpeg/probe';
import { makePreview, type PreviewDeps, uploadJpeg } from './preview';

export interface VideoFramesDeps extends PreviewDeps {
  download: (source: MediaSource, path: string, limits: FetchLimits) => Promise<void>;
  probe: (path: string) => Promise<VideoProbe>;
  extractFrames: (
    source: string,
    dir: string,
    intervalSeconds: number,
    maxFrames: number,
  ) => Promise<string[]>;
}

export interface VideoFramesOptions {
  maxSourceBytes: number;
  downloadTimeoutMs: number;
  workDir?: string;
}

/**
 * Downloads the source to a scratch directory, validates it with ffprobe before decoding
 * anything, then extracts a preview and frames at a fixed interval. The directory is
 * removed whatever happens, so a crash loop does not fill the disk.
 */
export class VideoFramesProcessor implements JobProcessor<VideoFramesInputV1> {
  readonly type = 'video.frames';
  readonly inputSchema = VideoFramesInputV1;

  constructor(
    private readonly deps: VideoFramesDeps,
    private readonly options: VideoFramesOptions,
  ) {}

  async process(job: JobContext, input: VideoFramesInputV1): Promise<VideoFramesOutputV1> {
    const dir = await mkdtemp(join(this.options.workDir ?? tmpdir(), `video-${job.jobId}-`));
    try {
      const source = join(dir, 'source');
      await this.deps.download(mediaSourceOf(input), source, {
        maxBytes: this.options.maxSourceBytes,
        timeoutMs: this.options.downloadTimeoutMs,
      });
      const probe = await this.deps.probe(source);
      const preview = await makePreview(this.deps, job.jobId, source, dir, probe.durationSeconds);

      const framePaths = await this.deps.extractFrames(
        source,
        dir,
        input.intervalSeconds,
        input.maxFrames,
      );
      if (framePaths.length === 0) throw new PermanentError('no frames could be decoded');
      const frames = await Promise.all(
        framePaths.map((path, i) =>
          uploadJpeg(this.deps, path, videoFrameKey(job.jobId, i), i * input.intervalSeconds),
        ),
      );

      return {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        codec: probe.codec,
        preview,
        frames,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
