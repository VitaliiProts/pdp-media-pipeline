import { spawn } from 'node:child_process';

export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`)),
    );
  });
}

const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args]);

export async function probeDuration(path) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    path,
  ]);
  return Number(stdout.trim());
}

/** Mono 16 kHz FLAC: small enough for any speech API, lossless for recognition. */
export const extractSpeechAudio = (source, out) =>
  ffmpeg(['-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', out]);

export const cutAudio = (source, start, end, out) =>
  ffmpeg(['-ss', String(start), '-to', String(end), '-i', source, '-c:a', 'flac', out]);

/** Speech intervals = gaps between silences longer than `minSilence` seconds. */
export async function speechIntervals(path, duration, { noiseDb = -30, minSilence = 0.4 } = {}) {
  const { stderr } = await ffmpeg([
    '-i',
    path,
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
    '-f',
    'null',
    '-',
  ]);
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const intervals = [];
  let cursor = 0;
  starts.forEach((silenceStart, i) => {
    if (silenceStart - cursor > 0.2) intervals.push({ start: cursor, end: silenceStart });
    cursor = ends[i] ?? duration;
  });
  if (duration - cursor > 0.2) intervals.push({ start: cursor, end: duration });
  return intervals;
}

/**
 * Original audio ducked under the voice (voiceover), then the voice on top. The voice is the
 * sidechain key, so the music dips only while someone speaks.
 */
export const mixDub = (source, voiceWav, out) =>
  ffmpeg([
    '-i',
    source,
    '-i',
    voiceWav,
    '-filter_complex',
    [
      '[0:a]aformat=sample_rates=48000:channel_layouts=stereo[bg]',
      '[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit[voice][key]',
      '[bg][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[ducked]',
      '[ducked][voice]amix=inputs=2:normalize=0:duration=first[dub]',
    ].join(';'),
    '-map',
    '[dub]',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    out,
  ]);

/** A real dub: the voice over music and effects with the original voice taken out. */
export const mixOverBackground = (background, voiceWav, out) =>
  ffmpeg([
    '-i',
    background,
    '-i',
    voiceWav,
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
    out,
  ]);

/** Video copied as is; dubbed track first and default, original second. */
export const muxDub = (source, dubAudio, out, { target, original }) =>
  ffmpeg([
    '-i',
    source,
    '-i',
    dubAudio,
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
    `language=${target}`,
    '-disposition:a:0',
    'default',
    '-metadata:s:a:1',
    `language=${original}`,
    '-disposition:a:1',
    '0',
    '-movflags',
    '+faststart',
    out,
  ]);
