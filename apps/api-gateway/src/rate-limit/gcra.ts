/**
 * GCRA (ADR-005). Each limit keeps one number, the theoretical arrival time (TAT):
 * the moment its bucket is empty again. Times are integer microseconds.
 *
 * This is the reference implementation: `GCRA_LUA` mirrors it line by line, the
 * local fallback runs it directly.
 */

export interface RateRule {
  key: string;
  ratePerSec: number;
  /** Requests allowed back to back after a quiet period. */
  burst: number;
}

export interface GcraLimit {
  /** Time between requests at the sustained rate. */
  intervalUs: number;
  /** How far ahead of now the TAT may run: `burst` intervals. */
  toleranceUs: number;
}

export interface LimitState {
  remaining: number;
  /** Until the bucket is empty, i.e. the full burst is available again. */
  resetUs: number;
}

export interface GcraDecision {
  allowed: boolean;
  /** 0 when allowed; otherwise the wait until every limit admits a request. */
  retryAfterUs: number;
  limits: LimitState[];
  /** TATs to store, only when allowed. */
  newTats: number[];
}

export function toGcraLimit(rule: Pick<RateRule, 'ratePerSec' | 'burst'>): GcraLimit {
  const intervalUs = Math.max(1, Math.round(1_000_000 / rule.ratePerSec));
  return { intervalUs, toleranceUs: intervalUs * Math.max(1, rule.burst) };
}

/** All or nothing: a request refused by one limit consumes none of the others. */
export function decide(
  limits: readonly GcraLimit[],
  storedTats: readonly (number | undefined)[],
  nowUs: number,
): GcraDecision {
  let allowed = true;
  let retryAfterUs = 0;
  const states: LimitState[] = [];
  const newTats: number[] = [];

  limits.forEach(({ intervalUs, toleranceUs }, i) => {
    const tat = Math.max(storedTats[i] ?? nowUs, nowUs);
    const newTat = tat + intervalUs;
    const allowAt = newTat - toleranceUs;
    if (nowUs < allowAt) {
      allowed = false;
      retryAfterUs = Math.max(retryAfterUs, allowAt - nowUs);
      states.push({ remaining: 0, resetUs: tat - nowUs });
    } else {
      newTats.push(newTat);
      states.push({
        remaining: Math.floor((nowUs - allowAt) / intervalUs),
        resetUs: newTat - nowUs,
      });
    }
  });

  return { allowed, retryAfterUs, limits: states, newTats: allowed ? newTats : [] };
}
