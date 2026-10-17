/** German at speed 1.0 in Supertonic, measured by tts-bench.mjs on ordinary sentences. */
export const CHARS_PER_SECOND = 14;
export const MAX_SPEED = 1.4;
/** A slightly slower voice is less audible than a phrase that ends before the actor stops. */
const MIN_SPEED = 0.9;
const MIN_GAP = 0.08;

const speedFor = (natural, target) =>
  Math.min(MAX_SPEED, Math.max(MIN_SPEED, natural / Math.max(0.1, target)));

const slotOf = (segments, i, videoEnd) => (segments[i + 1]?.start ?? videoEnd) - segments[i].start;

/** A first guess for the translator; the duration predictor has the last word. */
export const charBudget = (segments, i, videoEnd, speed = 1) =>
  Math.max(8, Math.floor(slotOf(segments, i, videoEnd) * CHARS_PER_SECOND * speed));

/** Speeding up beyond this is audible, so it costs more than a slightly off length. */
const COMFORT_SPEED = 1.15;
/** Seconds of length mismatch worth accepting to keep the next fuller phrasing. */
const FULLNESS = Number(process.env.FULLNESS ?? 0.3);

/**
 * Index of the phrasing (fullest first) whose spoken length is closest to the original phrase,
 * preferring little or no speed-up and more of the meaning. One that cannot fit its slot even
 * at MAX_SPEED wins only if none can, and then the one that overflows least.
 */
export function chooseVariant(predicted, speech, slot) {
  const cost = (p, k) => {
    const speed = speedFor(p, speech);
    const overflow = p / MAX_SPEED - slot;
    const misfit = overflow > 0 ? 100 + 10 * overflow : 0;
    const shape = Math.abs(p / speed - speech) + Math.abs(speed - 1);
    return misfit + shape + 3 * Math.max(0, speed - COMFORT_SPEED) + FULLNESS * k;
  };
  return predicted.reduce((best, p, k) => (cost(p, k) < cost(predicted[best], best) ? k : best), 0);
}

/**
 * Seconds by which a phrasing of natural length `p` misses the original after the speed
 * change: how far it runs past its slot at MAX_SPEED, or else how far its end is off.
 */
export const fitError = (p, speech, slot) =>
  p / MAX_SPEED > slot ? p / MAX_SPEED - slot : Math.abs(p / speedFor(p, speech) - speech);

export const speechOf = (segments, i, videoEnd) =>
  Math.min(segments[i].end - segments[i].start, slotOf(segments, i, videoEnd));
export { slotOf };

/** Phrases that would not fit their own slot even at the top speed. */
export const tooLong = (segments, natural, videoEnd) =>
  segments.flatMap((_, i) => (natural[i] / MAX_SPEED > slotOf(segments, i, videoEnd) ? [i] : []));

/**
 * Each phrase starts at its original time unless the previous one still speaks and aims to end
 * when the original ends, speeding up to MAX_SPEED or slowing down to MIN_SPEED for that.
 * Whatever runs past the next original start pushes the next phrase later.
 */
export function placePhrases(segments, natural, videoEnd) {
  let previousEnd = Number.NEGATIVE_INFINITY;
  return segments.map((segment, i) => {
    const place = Math.max(segment.start, previousEnd + MIN_GAP);
    const available = Math.max(0.1, (segments[i + 1]?.start ?? videoEnd) - place);
    const speed = speedFor(natural[i], Math.min(available, segment.end - place));
    const length = natural[i] / speed;
    previousEnd = place + length;
    return {
      ...segment,
      place,
      offset: place - segment.start,
      natural: natural[i],
      speed,
      length,
      overflow: Math.max(0, length - available),
    };
  });
}
