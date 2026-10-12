import { VIDEO_FRAME_WIDTH } from '@pdp/contracts';
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

  async probe(path: string): Promise<VideoProbe> {
    const { stdout } = await runProcess(this.options.ffprobePath, ffprobeArgs(path), {
      timeoutMs: this.options.timeoutMs,
    });
    return parseProbe(stdout, this.options.limits);
  }

  /** One decode pass; the fps filter picks a frame every `intervalSeconds` from the start. */
  async extractFrames(
    source: string,
    dir: string,
    intervalSeconds: number,
    maxFrames: number,
  ): Promise<string[]> {
    await this.ffmpeg([
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
    return files.map((f) => join(dir, f));
  }

  /** `-ss` before `-i` seeks the input, so the preview does not decode up to that point. */
  async extractPreview(source: string, output: string, atSeconds: number): Promise<void> {
    await this.ffmpeg([
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

  private async ffmpeg(args: string[]): Promise<void> {
    await runProcess(this.options.ffmpegPath, ['-nostdin', '-v', 'error', '-y', ...args], {
      timeoutMs: this.options.timeoutMs,
    });
  }
}
