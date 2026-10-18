import { type DubStep } from '@pdp/contracts';
import {
  type Counter,
  type Histogram,
  type MeterProvider,
  metrics,
  type ObservableGauge,
} from '@opentelemetry/api';
import { type BreakerState } from './providers/resilience';

/** A step reused from a checkpoint takes milliseconds; separating a minute, tens of seconds. */
const STEP_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120, 300];

export type ProviderOutcome = 'ok' | 'unavailable' | 'rejected' | 'cancelled' | 'error';

/** Of the gauge: 0 closed, 1 probing, 2 failing fast. */
const BREAKER_VALUE: Record<BreakerState, number> = { closed: 0, half_open: 1, open: 2 };

interface DubInstruments {
  step: Histogram;
  provider: Histogram;
  phrases: Counter;
  adjusted: Counter;
  cost: Counter;
  breaker: ObservableGauge;
}

const breakers = new Map<string, BreakerState>();
const cache = new WeakMap<MeterProvider, DubInstruments>();

/** Created on first use per provider, like the job metrics: see `@pdp/observability`. */
function instruments(): DubInstruments {
  const provider = metrics.getMeterProvider();
  const existing = cache.get(provider);
  if (existing) return existing;

  const meter = provider.getMeter('@pdp/dub');
  const created: DubInstruments = {
    step: meter.createHistogram('dub.step.duration', {
      description: 'One step of a dub attempt, checkpointed work included',
      unit: 's',
      advice: { explicitBucketBoundaries: STEP_BUCKETS },
    }),
    provider: meter.createHistogram('dub.provider.duration', {
      description: 'One call to a provider, its retries within the attempt included',
      unit: 's',
      advice: { explicitBucketBoundaries: STEP_BUCKETS },
    }),
    phrases: meter.createCounter('dub.phrases', {
      description: 'Phrases voiced in succeeded dubs',
      unit: '{phrase}',
    }),
    adjusted: meter.createCounter('dub.phrases.adjusted', {
      description: 'Voiced phrases that were sped up, rewritten shorter, or still ran over',
      unit: '{phrase}',
    }),
    cost: meter.createCounter('dub.cost.usd', {
      description: 'Estimated provider spend, in US dollars, failed attempts included',
      unit: '{USD}',
    }),
    breaker: meter.createObservableGauge('dub.breaker.state', {
      description: 'Circuit breaker per provider and pod: 0 closed, 1 half open, 2 open',
      unit: '{state}',
    }),
  };
  created.breaker.addCallback((result) => {
    for (const [name, state] of breakers) result.observe(BREAKER_VALUE[state], { provider: name });
  });
  cache.set(provider, created);
  return created;
}

export const dubMetrics = {
  step(step: DubStep, outcome: 'ok' | 'error', seconds: number): void {
    instruments().step.record(seconds, { step, outcome });
  },

  providerCall(
    provider: string,
    operation: string,
    outcome: ProviderOutcome,
    seconds: number,
  ): void {
    instruments().provider.record(seconds, { provider, operation, outcome });
  },

  cost(provider: string, usd: number): void {
    instruments().cost.add(usd, { provider });
  },

  phrases(stats: { phrases: number; sped: number; refitted: number; overflowed: number }): void {
    const { phrases, adjusted } = instruments();
    phrases.add(stats.phrases);
    for (const adjustment of ['sped', 'refitted', 'overflowed'] as const) {
      adjusted.add(stats[adjustment], { adjustment });
    }
  },

  breaker(provider: string, state: BreakerState): void {
    instruments();
    breakers.set(provider, state);
  },
};
