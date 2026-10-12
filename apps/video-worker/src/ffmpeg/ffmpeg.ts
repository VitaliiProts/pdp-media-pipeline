import { type Attributes, trace } from '@opentelemetry/api';
import { VIDEO_FRAME_WIDTH } from '@pdp/contracts';
import { traced } from '@pdp/observability';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ffprobeArgs, parseProbe, type ProbeLimits, type VideoProbe } from './probe';
import { runProcess } from './run-process';

export interface FfmpegOptions {
  ffmpegPath: string;
  ffprobePath: string;
  /** Per process run. */
  timeoutMs: number;
  limits: ProbeLimits;
}

/** Keeps the aspect ratio, never upscales, and keeps the height even for the JPEG encoder. */
const SCALE = `scale='min(${VIDEO_FRAME_WIDTH},iw)':-2`;
const FRAME_PATTERN = /^frame-(\d{4})\.jpg$/;

export class Ffmpeg {
  constructor(private readonly options: FfmpegOptions) {}

  probe(path: string): Promise<VideoProbe> {
    return traced('ffprobe', {}, async (span) => {
      const { stdout } = await runProcess(this.options.ffprobePath, ffprobeArgs(path), {
        timeoutMs: this.options.timeoutMs,
      });
      const probe = parseProbe(stdout, this.options.limits);
      span.setAttributes({
        'video.duration_seconds': probe.durationSeconds,
        'video.width': probe.width,
        'video.height': probe.height,
        'video.codec': probe.codec,
      });
      return probe;
    });
  }

  /** One decode pass; the fps filter picks a frame every `intervalSeconds` from the start. */
  async extractFrames(
    source: string,
    dir: string,
    intervalSeconds: number,
    maxFrames: number,
  ): Promise<string[]> {
    await this.ffmpeg('ffmpeg frames', { 'video.interval_seconds': intervalSeconds }, [
      '-i',
      source,
      '-vf',
      `fps=1/${intervalSeconds},${SCALE}`,
      '-frames:v',
      String(maxFrames),
      '-q:v',
      '4',
      '-f',
      'image2',
      join(dir, 'frame-%04d.jpg'),
    ]);
    const files = (await readdir(dir)).filter((f) => FRAME_PATTERN.test(f)).sort();
    trace.getActiveSpan()?.setAttribute('video.frames', files.length);
    return files.map((f) => join(dir, f));
  }

  /** `-ss` before `-i` seeks the input, so the preview does not decode up to that point. */
  async extractPreview(source: string, output: string, atSeconds: number): Promise<void> {
    await this.ffmpeg('ffmpeg preview', { 'video.at_seconds': atSeconds }, [
      '-ss',
      atSeconds.toFixed(3),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      SCALE,
      '-q:v',
      '3',
      output,
    ]);
  }

  private async ffmpeg(span: string, attributes: Attributes, args: string[]): Promise<void> {
    await traced(span, { attributes }, () =>
      runProcess(this.options.ffmpegPath, ['-nostdin', '-v', 'error', '-y', ...args], {
        timeoutMs: this.options.timeoutMs,
      }),
    );
  }
}
