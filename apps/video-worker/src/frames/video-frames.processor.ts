import {
  type MediaSource,
  mediaSourceOf,
  type VideoFrame,
  videoFrameKey,
  VideoFramesInputV1,
  type VideoFramesOutputV1,
  videoPreviewKey,
} from '@pdp/contracts';
import {
  type FetchLimits,
  type JobContext,
  type JobProcessor,
  PermanentError,
} from '@pdp/worker-kit';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jpegSize } from '../ffmpeg/jpeg-size';
import { type VideoProbe } from '../ffmpeg/probe';

export interface VideoFramesDeps {
  download: (source: MediaSource, path: string, limits: FetchLimits) => Promise<void>;
  probe: (path: string) => Promise<VideoProbe>;
  extractFrames: (
    source: string,
    dir: string,
    intervalSeconds: number,
    maxFrames: number,
  ) => Promise<string[]>;
  extractPreview: (source: string, output: string, atSeconds: number) => Promise<void>;
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
}

export interface VideoFramesOptions {
  maxSourceBytes: number;
  downloadTimeoutMs: number;
  workDir?: string;
}

/** A second in: the first frame is often black or a fade-in. */
const PREVIEW_AT_SECONDS = 1;

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

      const previewPath = join(dir, 'preview.jpg');
      const previewAt = Math.min(PREVIEW_AT_SECONDS, probe.durationSeconds / 2);
      await this.deps.extractPreview(source, previewPath, previewAt);
      const preview = await this.upload(previewPath, videoPreviewKey(job.jobId), previewAt);

      const framePaths = await this.deps.extractFrames(
        source,
        dir,
        input.intervalSeconds,
        input.maxFrames,
      );
      if (framePaths.length === 0) throw new PermanentError('no frames could be decoded');
      const frames = await Promise.all(
        framePaths.map((path, i) =>
          this.upload(path, videoFrameKey(job.jobId, i), i * input.intervalSeconds),
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

  private async upload(path: string, key: string, atSeconds: number): Promise<VideoFrame> {
    const data = await readFile(path);
    const { width, height } = jpegSize(data);
    await this.deps.putObject(key, data, 'image/jpeg');
    return { key, atSeconds, width, height, bytes: data.length };
  }
}
