import { collectDefaultMetrics, Counter, register } from 'prom-client';

/**
 * Get-or-create: several Nest apps can share one process (integration tests), and
 * prom-client refuses to register the same name twice.
 */
export function counter<L extends string>(name: string, help: string, labelNames: L[]): Counter<L> {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as Counter<L>;
  return new Counter({ name, help, labelNames });
}

let defaultsCollected = false;

export function collectProcessMetrics(): void {
  if (defaultsCollected) return;
  defaultsCollected = true;
  collectDefaultMetrics();
}

export const metricsRegistry = register;

/** Counters required by the PDP from the first reliability stage on. */
export const jobMetrics = {
  /**
   * A delivery or publish recognised as one already processed: `inbox` in Metadata,
   * `dispatch` / `outbox` when JetStream dropped a republished message.
   */
  duplicates: counter('jobs_duplicates_total', 'Duplicate deliveries or publishes detected', [
    'source',
  ]),
  deadLettered: counter('jobs_dlq_total', 'Jobs moved to the dead letter queue', [
    'type',
    'reason',
  ]),
  retries: counter('jobs_retries_total', 'Failed attempts handed back for a retry', ['type']),
};
