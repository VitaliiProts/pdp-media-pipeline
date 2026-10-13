import {
  type MediaSource,
  mediaSourceOf,
  type RenditionResult,
  renditionKey,
  VideoTranscodeInputV1,
  type VideoTranscodeOutputV1,
} from '@pdp/contracts';
import { type FetchLimits, type JobContext, type JobProcessor } from '@pdp/worker-kit';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type VideoProbe } from '../ffmpeg/probe';
import { planRenditions, type RenditionOutput } from '../ffmpeg/transcode';
import { makePreview, type PreviewDeps } from '../frames/preview';

export interface VideoTranscodeDeps extends PreviewDeps {
  download: (source: MediaSource, path: string, limits: FetchLimits) => Promise<void>;
  /** The source, against the transcoding limits. */
  probe: (path: string) => Promise<VideoProbe>;
  /** A finished rendition, for its real size and duration. */
  probeOutput: (path: string) => Promise<VideoProbe>;
  transcode: (
    source: string,
    outputs: readonly RenditionOutput[],
    probe: VideoProbe,
    onProgress: (fraction: number) => void,
  ) => Promise<void>;
  /** @returns bytes uploaded */
  uploadFile: (key: string, path: string, contentType: string) => Promise<number>;
}

export interface VideoTranscodeOptions {
  maxSourceBytes: number;
  downloadTimeoutMs: number;
  workDir?: string;
}

/** Uploads come after the encode; 100% is left for `succeeded`. */
const MAX_REPORTED_PERCENT = 99;

/**
 * Same shape as `video.frames`: download to scratch, ffprobe before decoding, then one ffmpeg
 * run that writes every rendition. Progress is the encoded share of the source duration.
 */
export class VideoTranscodeProcessor implements JobProcessor<VideoTranscodeInputV1> {
  readonly type = 'video.transcode';
  readonly inputSchema = VideoTranscodeInputV1;

  constructor(
    private readonly deps: VideoTranscodeDeps,
    private readonly options: VideoTranscodeOptions,
  ) {}

  async process(job: JobContext, input: VideoTranscodeInputV1): Promise<VideoTranscodeOutputV1> {
    const dir = await mkdtemp(join(this.options.workDir ?? tmpdir(), `transcode-${job.jobId}-`));
    try {
      const source = join(dir, 'source');
      await this.deps.download(mediaSourceOf(input), source, {
        maxBytes: this.options.maxSourceBytes,
        timeoutMs: this.options.downloadTimeoutMs,
      });
      const probe = await this.deps.probe(source);
      const { targets, skipped } = planRenditions(probe, input.renditions);
      const preview = await makePreview(this.deps, job.jobId, source, dir, probe.durationSeconds);

      job.progress(0);
      const outputs = targets.map((t) => ({ ...t, path: join(dir, `${t.rendition}.mp4`) }));
      await this.deps.transcode(source, outputs, probe, (fraction) =>
        job.progress(Math.min(MAX_REPORTED_PERCENT, fraction * 100)),
      );
      const renditions = await Promise.all(outputs.map((o) => this.upload(job.jobId, o)));

      return {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        codec: probe.codec,
        preview,
        renditions,
        skipped,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async upload(jobId: string, output: RenditionOutput): Promise<RenditionResult> {
    const { width, height, durationSeconds } = await this.deps.probeOutput(output.path);
    const key = renditionKey(jobId, output.rendition);
    const bytes = await this.deps.uploadFile(key, output.path, 'video/mp4');
    return {
      rendition: output.rendition,
      key,
      width,
      height,
      durationSeconds,
      bytes,
      bitrate: Math.round((bytes * 8) / durationSeconds),
    };
  }
}
