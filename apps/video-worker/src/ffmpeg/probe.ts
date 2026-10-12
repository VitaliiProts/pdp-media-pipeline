import { VIDEO_CODECS } from '@pdp/contracts';
import { PermanentError } from '@pdp/worker-kit';
import { z } from 'zod';

export type VideoCodec = (typeof VIDEO_CODECS)[number];

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  codec: VideoCodec;
}

export interface ProbeLimits {
  maxDurationSeconds: number;
  maxDimension: number;
}

/** `ffprobe -show_format -show_streams -select_streams v:0 -print_format json`. */
const FfprobeOutput = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.string().optional(),
      }),
    )
    .default([]),
  format: z.object({ duration: z.string().optional() }).optional(),
});

export const ffprobeArgs = (path: string): string[] => [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  '-select_streams',
  'v:0',
  path,
];

const isVideoCodec = (codec: string): codec is VideoCodec =>
  (VIDEO_CODECS as readonly string[]).includes(codec);

/** Everything wrong here is a property of the file, so every failure is permanent. */
export function parseProbe(stdout: string, limits: ProbeLimits): VideoProbe {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new PermanentError('ffprobe returned unreadable output');
  }
  const parsed = FfprobeOutput.safeParse(raw);
  if (!parsed.success) throw new PermanentError('ffprobe returned unexpected output');

  const stream = parsed.data.streams.find((s) => s.codec_type === 'video');
  if (!stream?.codec_name) throw new PermanentError('no video stream');
  if (!isVideoCodec(stream.codec_name)) {
    throw new PermanentError(`codec ${stream.codec_name} is not supported`);
  }

  const { width, height } = stream;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new PermanentError('video has no frame size');
  }
  if (width > limits.maxDimension || height > limits.maxDimension) {
    throw new PermanentError(`${width}x${height} exceeds ${limits.maxDimension}px`);
  }

  const durationSeconds = Number(stream.duration ?? parsed.data.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new PermanentError('video duration is unknown');
  }
  if (durationSeconds > limits.maxDurationSeconds) {
    throw new PermanentError(
      `video is ${durationSeconds.toFixed(1)}s, limit ${limits.maxDurationSeconds}s`,
    );
  }

  return { durationSeconds, width, height, codec: stream.codec_name };
}
