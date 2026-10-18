import { PermanentError } from '@pdp/worker-kit';
import { parseProbe } from '../../ffmpeg/probe';

/** All streams: the dub needs the video and the first sound track. */
export const dubProbeArgs = (path: string): string[] => [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  path,
];

/** Checked before the first paid step; every failure is a property of the file. */
export function parseDubProbe(
  stdout: string,
  maxDurationSeconds: number,
): { durationSeconds: number } {
  const { durationSeconds } = parseProbe(stdout, {
    maxDurationSeconds: Number.POSITIVE_INFINITY,
    maxDimension: Number.POSITIVE_INFINITY,
  });
  if (durationSeconds > maxDurationSeconds) {
    throw new PermanentError(
      `video is ${durationSeconds.toFixed(1)}s, limit ${maxDurationSeconds}s`,
      'too_long',
    );
  }
  const { streams } = JSON.parse(stdout) as { streams: { codec_type?: string }[] };
  if (!streams.some((s) => s.codec_type === 'audio')) {
    throw new PermanentError('the video has no sound', 'no_audio');
  }
  return { durationSeconds };
}

/** The first sound track as the separation model takes it: 44.1 kHz stereo, lossless. */
export const extractAudioArgs = (source: string, output: string): string[] => [
  '-i',
  source,
  '-map',
  '0:a:0',
  '-vn',
  '-ac',
  '2',
  '-ar',
  '44100',
  '-c:a',
  'flac',
  output,
];

/** Mono 16 kHz FLAC: what recognition was measured on, and small for the upload. */
export const speechAudioArgs = (source: string, output: string): string[] => [
  '-i',
  source,
  '-ac',
  '1',
  '-ar',
  '16000',
  '-c:a',
  'flac',
  output,
];

/** The voice over music and effects with the original voice taken out. */
export const mixArgs = (background: string, voice: string, output: string): string[] => [
  '-i',
  background,
  '-i',
  voice,
  '-filter_complex',
  [
    '[0:a]aformat=sample_rates=48000:channel_layouts=stereo[bg]',
    '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[voice]',
    '[bg][voice]amix=inputs=2:normalize=0:duration=first[dub]',
  ].join(';'),
  '-map',
  '[dub]',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  output,
];

const ISO_639_2: Record<string, string> = {
  ar: 'ara',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  fi: 'fin',
  fr: 'fra',
  he: 'heb',
  hi: 'hin',
  hu: 'hun',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  nl: 'nld',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sv: 'swe',
  tr: 'tur',
  uk: 'ukr',
  zh: 'zho',
};

/** MP4 tags tracks in ISO 639-2; a language not listed is `und`, undetermined. */
export const languageTag = (code: string): string => ISO_639_2[code] ?? 'und';

/**
 * The video copied as is; the dub is the first and default track, the original second, so a
 * player without a track menu plays the dub and one with a menu can switch back.
 */
export const muxArgs = (
  source: string,
  dub: string,
  output: string,
  languages: { target: string; original: string },
): string[] => [
  '-i',
  source,
  '-i',
  dub,
  '-map',
  '0:v:0',
  '-map',
  '1:a:0',
  '-map',
  '0:a:0',
  '-c:v',
  'copy',
  '-c:a',
  'copy',
  '-metadata:s:a:0',
  `language=${languageTag(languages.target)}`,
  '-disposition:a:0',
  'default',
  '-metadata:s:a:1',
  `language=${languageTag(languages.original)}`,
  '-disposition:a:1',
  '0',
  '-movflags',
  '+faststart',
  output,
];

/** Clips summed at their places into one track as long as the video. */
export function renderVoiceTrack(
  clips: readonly { startSeconds: number; samples: Float32Array }[],
  durationSeconds: number,
  sampleRate: number,
): Float32Array {
  const track = new Float32Array(Math.ceil(durationSeconds * sampleRate));
  for (const { startSeconds, samples } of clips) {
    const at = Math.round(startSeconds * sampleRate);
    const end = Math.min(samples.length, track.length - at);
    for (let i = 0; i < end; i++) track[at + i]! += samples[i]!;
  }
  return track;
}

/** 16-bit mono PCM from samples in -1..1; louder ones are clipped. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = samples.length * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  samples.forEach((s, i) =>
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2),
  );
  return wav;
}

const vttTime = (seconds: number) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(
    Math.floor(ms / 1000) % 60,
  )}.${pad(ms % 1000, 3)}`;
};

const vttText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Subtitles of the dub at the places the phrases are spoken, not where the original ones were. */
export const toVtt = (cues: readonly { start: number; end: number; text: string }[]): string =>
  [
    'WEBVTT',
    '',
    ...cues.flatMap((c) => [`${vttTime(c.start)} --> ${vttTime(c.end)}`, vttText(c.text), '']),
  ].join('\n');
