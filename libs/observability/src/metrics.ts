import { type Counter, type Histogram, type MeterProvider, metrics } from '@opentelemetry/api';

/**
 * Bucket bounds for job latencies, in seconds. The SLI counts the bucket at each type's
 * threshold (the `le` of `job:slo_objective:ratio`): 300 for images and frames (ADR-008),
 * 600 for transcoding (ADR-011). Both have to stay bounds.
 */
export const JOB_LATENCY_BUCKETS = [1, 2.5, 5, 10, 20, 30, 60, 120, 180, 300, 600, 1800, 3600];

/** One attempt in a worker: from milliseconds for a thumbnail to ten minutes for a transcode. */
export const JOB_ATTEMPT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600];

/** How a job ended: `exhausted` and `permanent` are the two dead reasons. */
export type JobOutcome = 'succeeded' | 'exhausted' | 'permanent';

export interface JobLabels {
  type: string;
  class: string | null;
}

interface JobInstruments {
  created: Counter;
  finished: Counter;
  e2e: Histogram;
  queueWait: Histogram;
  attempt: Histogram;
  retries: Counter;
  interrupted: Counter;
  deadLettered: Counter;
  duplicates: Counter;
}

const cache = new WeakMap<MeterProvider, JobInstruments>();

/**
 * The metrics API has no proxy provider: instruments made before the SDK starts stay
 * no-ops forever. Creating them on first use, per provider, works whatever the import
 * order, and gives in-process tests their own instruments.
 */
function instruments(): JobInstruments {
  const provider = metrics.getMeterProvider();
  const existing = cache.get(provider);
  if (existing) return existing;

  const meter = provider.getMeter('@pdp/jobs');
  const created: JobInstruments = {
    created: meter.createCounter('jobs.created', {
      description: 'Jobs accepted by the API',
      unit: '{job}',
    }),
    finished: meter.createCounter('jobs.finished', {
      description: 'Jobs that reached succeeded or dead, redriven generations included',
      unit: '{job}',
    }),
    e2e: meter.createHistogram('job.e2e.duration', {
      description: 'From creation to succeeded or dead; the SLI of ADR-001 and ADR-008',
      unit: 's',
      advice: { explicitBucketBoundaries: JOB_LATENCY_BUCKETS },
    }),
    queueWait: meter.createHistogram('job.queue_wait', {
      description: 'From scheduled to the first attempt starting in a worker',
      unit: 's',
      advice: { explicitBucketBoundaries: JOB_LATENCY_BUCKETS },
    }),
    attempt: meter.createHistogram('job.attempt.duration', {
      description: 'One attempt in a worker, from start to its result',
      unit: 's',
      advice: { explicitBucketBoundaries: JOB_ATTEMPT_BUCKETS },
    }),
    retries: meter.createCounter('jobs.retries', {
      description: 'Failed attempts handed back for a retry',
      unit: '{attempt}',
    }),
    interrupted: meter.createCounter('jobs.interrupted', {
      description: 'Attempts handed back unfinished by a worker shutting down',
      unit: '{attempt}',
    }),
    deadLettered: meter.createCounter('jobs.dlq', {
      description: 'Jobs moved to the dead letter queue',
      unit: '{job}',
    }),
    duplicates: meter.createCounter('jobs.duplicates', {
      description: 'Duplicate deliveries or publishes detected',
      unit: '{message}',
    }),
  };
  cache.set(provider, created);
  return created;
}

const labels = (job: JobLabels) => ({ type: job.type, class: job.class ?? 'none' });

/** Metrics required by the PDP; names in VictoriaMetrics are in the README. */
export const jobMetrics = {
  created(type: string, count = 1): void {
    instruments().created.add(count, { type });
  },

  /**
   * @param e2eSeconds `null` for a redriven generation: its age includes the time it lay
   *   dead until an operator acted, which is not the pipeline's latency.
   */
  finished(job: JobLabels, outcome: JobOutcome, e2eSeconds: number | null): void {
    const attributes = { ...labels(job), outcome };
    instruments().finished.add(1, attributes);
    if (e2eSeconds !== null) instruments().e2e.record(e2eSeconds, attributes);
  },

  queueWait(job: JobLabels, seconds: number): void {
    instruments().queueWait.record(seconds, labels(job));
  },

  attempt(
    type: string,
    outcome: 'succeeded' | 'retry' | 'failed' | 'interrupted',
    seconds: number,
  ): void {
    instruments().attempt.record(seconds, { type, outcome });
  },

  retry(type: string): void {
    instruments().retries.add(1, { type });
  },

  interrupted(type: string): void {
    instruments().interrupted.add(1, { type });
  },

  deadLettered(type: string, reason: string): void {
    instruments().deadLettered.add(1, { type, reason });
  },

  /**
   * A delivery or publish recognised as one already processed: `inbox` in Metadata,
   * `dispatch` / `outbox` when JetStream dropped a republished message.
   */
  duplicate(source: 'inbox' | 'dispatch' | 'outbox'): void {
    instruments().duplicates.add(1, { source });
  },
};
