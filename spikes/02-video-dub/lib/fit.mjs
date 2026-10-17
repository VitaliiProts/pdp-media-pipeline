/** German at speed 1.0 in Supertonic, measured by tts-bench.mjs on ordinary sentences. */
export const CHARS_PER_SECOND = 14;
export const MAX_SPEED = 1.4;
const MIN_GAP = 0.08;

const slotOf = (segments, i, videoEnd) => (segments[i + 1]?.start ?? videoEnd) - segments[i].start;

/** A first guess for the translator; the duration predictor has the last word. */
export const charBudget = (segments, i, videoEnd, speed = 1) =>
  Math.max(8, Math.floor(slotOf(segments, i, videoEnd) * CHARS_PER_SECOND * speed));

/** Phrases that would not fit their own slot even at the top speed. */
export const tooLong = (segments, natural, videoEnd) =>
  segments.flatMap((_, i) => (natural[i] / MAX_SPEED > slotOf(segments, i, videoEnd) ? [i] : []));

/**
 * Each phrase starts at its original time unless the previous one still speaks, takes the time
 * up to the next original start, and speeds up to MAX_SPEED to fit it; there is no slowing down.
 * Whatever still does not fit pushes the next phrase later.
 */
export function placePhrases(segments, natural, videoEnd) {
  let previousEnd = Number.NEGATIVE_INFINITY;
  return segments.map((segment, i) => {
    const place = Math.max(segment.start, previousEnd + MIN_GAP);
    const available = Math.max(0.1, (segments[i + 1]?.start ?? videoEnd) - place);
    const speed = Math.min(MAX_SPEED, Math.max(1, natural[i] / available));
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
