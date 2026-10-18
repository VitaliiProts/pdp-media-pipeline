/**
 * Cuts the quiet head and tail: 10 ms windows quieter than `floor` of the clip peak (−30 dB)
 * count as silence, and `margin` seconds are kept so soft consonants are not clipped.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  { floor = 0.03, margin = 0.03 } = {},
): Float32Array {
  const win = Math.round(sampleRate * 0.01);
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  let first = -1;
  let last = -1;
  for (let w = 0; (w + 1) * win <= samples.length; w++) {
    let sum = 0;
    for (let j = w * win; j < (w + 1) * win; j++) sum += samples[j]! * samples[j]!;
    if (Math.sqrt(sum / win) > peak * floor) {
      if (first < 0) first = w;
      last = w;
    }
  }
  if (first < 0) return samples;
  const keep = Math.round(margin * sampleRate);
  return samples.subarray(
    Math.max(0, first * win - keep),
    Math.min(samples.length, (last + 1) * win + keep),
  );
}
