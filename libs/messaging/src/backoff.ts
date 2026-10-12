export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

/**
 * Exponential backoff with full jitter: a uniformly random delay up to
 * `min(maxMs, baseMs × 2^(n−1))`. Spreading the whole range keeps retries of jobs
 * that failed together from hitting the dependency together again.
 *
 * @param failures how many attempts have failed so far, starting at 1
 */
export function fullJitterDelay(
  failures: number,
  { baseMs, maxMs }: BackoffOptions,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(Math.max(failures, 1) - 1, 30);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);
  return Math.floor(random() * ceiling);
}
