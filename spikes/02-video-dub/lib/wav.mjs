import { writeFileSync } from 'node:fs';

/** 16-bit mono PCM WAV from float samples in -1..1. */
export function writeWav(path, samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

/**
 * Cuts the quiet head and tail: 10 ms windows quieter than `floor` of the clip peak (−30 dB)
 * count as silence, and `margin` seconds are kept so soft consonants are not clipped.
 */
export function trimSilence(samples, sampleRate, { floor = 0.03, margin = 0.03 } = {}) {
  const win = Math.round(sampleRate * 0.01);
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const loud = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    loud.push(Math.sqrt(sum / win) > peak * floor);
  }
  const first = loud.indexOf(true);
  if (first < 0) return samples;
  const keep = Math.round(margin * sampleRate);
  const from = Math.max(0, first * win - keep);
  const to = Math.min(samples.length, (loud.lastIndexOf(true) + 1) * win + keep);
  return samples.subarray(from, to);
}
