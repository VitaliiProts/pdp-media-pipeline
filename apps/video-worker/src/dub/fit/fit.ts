/** Faster is audible as hurry; Supertonic stays clear up to here. */
export const MAX_SPEED = 1.4;
/** A slightly slower voice is less audible than a phrase that ends before the actor stops. */
export const MIN_SPEED = 0.9;
/** Speeding up beyond this is audible, so it costs more than a slightly off length. */
const COMFORT_SPEED = 1.15;
/** Seconds of length mismatch worth accepting to keep the next fuller phrasing. */
const FULLNESS = 0.3;
/** Between a phrase that runs late and the next one. */
const MIN_GAP_SECONDS = 0.08;
/** A refit asks for this much more than the slot when the speech runs to its end. */
const REFIT_SLOT_STRETCH = 1.15;
export const REFIT_ABOVE_SECONDS = 0.5;
const MIN_CHARS = 8;

export interface Timed {
  start: number;
  end: number;
}

const speedFor = (natural: number, target: number) =>
  Math.min(MAX_SPEED, Math.max(MIN_SPEED, natural / Math.max(0.1, target)));

/** Time until the next phrase starts, or the video ends. */
export const slotOf = (phrases: readonly Timed[], i: number, videoEnd: number): number =>
  (phrases[i + 1]?.start ?? videoEnd) - phrases[i]!.start;

/** How long the original speaks, within its slot. */
export const speechOf = (phrases: readonly Timed[], i: number, videoEnd: number): number =>
  Math.min(phrases[i]!.end - phrases[i]!.start, slotOf(phrases, i, videoEnd));

/** A first guess for the translator; the duration predictor has the last word. */
export const charBudget = (slotSeconds: number, charsPerSecond: number): number =>
  Math.max(MIN_CHARS, Math.floor(slotSeconds * charsPerSecond));

/**
 * Index of the phrasing (fullest first) whose spoken length is closest to the original phrase,
 * preferring little or no speed-up and more of the meaning. One that cannot fit its slot even
 * at MAX_SPEED wins only if none can, and then the one that overflows least.
 */
export function chooseVariant(predicted: readonly number[], speech: number, slot: number): number {
  const cost = (p: number, k: number) => {
    const speed = speedFor(p, speech);
    const overflow = p / MAX_SPEED - slot;
    const misfit = overflow > 0 ? 100 + 10 * overflow : 0;
    const shape = Math.abs(p / speed - speech) + Math.abs(speed - 1);
    return misfit + shape + 3 * Math.max(0, speed - COMFORT_SPEED) + FULLNESS * k;
  };
  let best = 0;
  predicted.forEach((p, k) => {
    if (cost(p, k) < cost(predicted[best]!, best)) best = k;
  });
  return best;
}

/**
 * Seconds by which a phrasing of natural length `predicted` misses the original after the
 * speed change: how far it runs past its slot at MAX_SPEED, or else how far its end is off.
 */
export function fitError(predicted: number, speech: number, slot: number): number {
  const overflow = predicted / MAX_SPEED - slot;
  return overflow > 0 ? overflow : Math.abs(predicted / speedFor(predicted, speech) - speech);
}

export const needsRefit = (predicted: number, speech: number, slot: number): boolean =>
  fitError(predicted, speech, slot) > REFIT_ABOVE_SECONDS;

/** Words to ask a refit for, at the speech rate the voice has for the fullest phrasing. */
export function refitWords(
  fullestWords: number,
  fullestSeconds: number,
  speech: number,
  slot: number,
): number {
  const target = Math.min(speech, slot * REFIT_SLOT_STRETCH);
  return Math.max(1, Math.round((fullestWords / fullestSeconds) * target));
}

export interface Placement {
  placedStart: number;
  placedEnd: number;
  speed: number;
  /** Seconds spoken past the start of the next phrase or the end of the video. */
  overflow: number;
}

/**
 * Each phrase starts at its original time unless the previous one still speaks, and aims to end
 * when the original ends, speeding up to MAX_SPEED or slowing down to MIN_SPEED for that.
 * Whatever runs past the next original start pushes the next phrase later.
 */
export function placePhrases(
  phrases: readonly Timed[],
  natural: readonly number[],
  videoEnd: number,
): Placement[] {
  let previousEnd = Number.NEGATIVE_INFINITY;
  return phrases.map((phrase, i) => {
    const placedStart = Math.max(phrase.start, previousEnd + MIN_GAP_SECONDS);
    const available = Math.max(0.1, (phrases[i + 1]?.start ?? videoEnd) - placedStart);
    const speed = speedFor(natural[i]!, Math.min(available, phrase.end - placedStart));
    const placedEnd = placedStart + natural[i]! / speed;
    previousEnd = placedEnd;
    return {
      placedStart,
      placedEnd,
      speed,
      overflow: Math.max(0, placedEnd - placedStart - available),
    };
  });
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function fitStats(
  phrases: readonly Timed[],
  placements: readonly Placement[],
  refitted: readonly boolean[],
): {
  phrases: number;
  sped: number;
  refitted: number;
  overflowed: number;
  meanEndErrorSeconds: number;
} {
  const endError = placements.reduce(
    (sum, p, i) => sum + Math.abs(p.placedEnd - phrases[i]!.end),
    0,
  );
  return {
    phrases: phrases.length,
    sped: placements.filter((p) => p.speed > 1.01).length,
    refitted: refitted.filter(Boolean).length,
    overflowed: placements.filter((p) => p.overflow > 0.01).length,
    meanEndErrorSeconds: phrases.length ? round2(endError / phrases.length) : 0,
  };
}
