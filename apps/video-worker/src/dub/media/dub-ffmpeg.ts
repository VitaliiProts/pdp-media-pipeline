import { type Attributes } from '@opentelemetry/api';
import { traced } from '@pdp/observability';
import { type RunOptions, runProcess } from '../../ffmpeg/run-process';
import {
  dubProbeArgs,
  extractAudioArgs,
  mixArgs,
  muxArgs,
  parseDubProbe,
  speechAudioArgs,
} from './dub-media';

export interface DubFfmpegOptions {
  ffmpegPath: string;
  ffprobePath: string;
  /** Per run; a minute of video takes seconds for each of these. */
  timeoutMs: number;
}

export class DubFfmpeg {
  constructor(private readonly options: DubFfmpegOptions) {}

  probe(
    path: string,
    maxDurationSeconds: number,
    signal?: AbortSignal,
  ): Promise<{ durationSeconds: number }> {
    return traced('ffprobe dub', {}, async (span) => {
      const { stdout } = await runProcess(this.options.ffprobePath, dubProbeArgs(path), {
        timeoutMs: this.options.timeoutMs,
        signal,
      });
      const probe = parseDubProbe(stdout, maxDurationSeconds);
      span.setAttribute('video.duration_seconds', probe.durationSeconds);
      return probe;
    });
  }

  extractAudio(source: string, output: string, signal?: AbortSignal): Promise<void> {
    return this.ffmpeg('ffmpeg dub audio', {}, extractAudioArgs(source, output), { signal });
  }

  speechAudio(audio: string, output: string, signal?: AbortSignal): Promise<void> {
    return this.ffmpeg('ffmpeg dub speech', {}, speechAudioArgs(audio, output), { signal });
  }

  mix(background: string, voice: string, output: string, signal?: AbortSignal): Promise<void> {
    return this.ffmpeg('ffmpeg dub mix', {}, mixArgs(background, voice, output), { signal });
  }

  mux(
    source: string,
    dub: string,
    output: string,
    languages: { target: string; original: string },
    signal?: AbortSignal,
  ): Promise<void> {
    return this.ffmpeg(
      'ffmpeg dub mux',
      { 'dub.target_language': languages.target, 'dub.source_language': languages.original },
      muxArgs(source, dub, output, languages),
      { signal },
    );
  }

  private async ffmpeg(
    span: string,
    attributes: Attributes,
    args: string[],
    run: Partial<RunOptions>,
  ): Promise<void> {
    await traced(span, { attributes }, () =>
      runProcess(this.options.ffmpegPath, ['-nostdin', '-v', 'error', '-y', ...args], {
        timeoutMs: this.options.timeoutMs,
        ...run,
      }),
    );
  }
}
