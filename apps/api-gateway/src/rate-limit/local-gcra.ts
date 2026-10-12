import { decide, type GcraDecision, type GcraLimit } from './gcra';

const PRUNE_ABOVE = 10_000;

/** In-process GCRA for when Redis is unavailable. State is per replica and lost on restart. */
export class LocalGcra {
  private readonly tats = new Map<string, number>();

  check(
    keys: readonly string[],
    limits: readonly GcraLimit[],
    nowUs = Date.now() * 1000,
  ): GcraDecision {
    if (this.tats.size > PRUNE_ABOVE) this.prune(nowUs);
    const decision = decide(
      limits,
      keys.map((key) => this.tats.get(key)),
      nowUs,
    );
    keys.forEach((key, i) => {
      const tat = decision.newTats[i];
      if (tat !== undefined) this.tats.set(key, tat);
    });
    return decision;
  }

  /** A TAT in the past means an empty bucket, the same as no entry. */
  private prune(nowUs: number): void {
    for (const [key, tat] of this.tats) if (tat <= nowUs) this.tats.delete(key);
  }
}
