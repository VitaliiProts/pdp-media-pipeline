import { trimSilence } from './trim-silence';

const RATE = 16_000;
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const tone = (seconds: number) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    Math.sin((2 * Math.PI * 220 * i) / RATE),
  );
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('trimSilence', () => {
  it('cuts the quiet head and tail and keeps a short margin', () => {
    const trimmed = trimSilence(concat(silence(0.5), tone(1), silence(0.7)), RATE);
    expect(trimmed.length / RATE).toBeCloseTo(1 + 2 * 0.03, 1);
  });

  it('keeps quiet parts between loud ones', () => {
    const trimmed = trimSilence(concat(tone(0.3), silence(0.4), tone(0.3)), RATE);
    expect(trimmed.length / RATE).toBeCloseTo(1, 1);
  });

  it('leaves a clip without anything loud as it is', () => {
    const quiet = silence(0.5);
    expect(trimSilence(quiet, RATE)).toBe(quiet);
  });
});
