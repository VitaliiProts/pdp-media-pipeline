import { Logger } from '@nestjs/common';
import { MetadataError } from '@pdp/metadata-client';

export interface ProgressReporterOptions {
  /** At most one update per interval. */
  intervalMs: number;
  now?: () => number;
}

/**
 * Turns a stream of progress values into occasional fire-and-forget updates. Never two at
 * once and never awaited by the job, so a slow or failing Metadata delays the progress bar,
 * not the work. A rejection (4xx) means this attempt is no longer the running one: it stops.
 */
export class ProgressReporter {
  private readonly logger = new Logger(ProgressReporter.name);
  private readonly now: () => number;
  private lastSent = -1;
  private lastAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private stopped = false;

  constructor(
    private readonly send: (percent: number) => Promise<void>,
    private readonly options: ProgressReporterOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Whole percent, clamped to 0..100; lower or equal values are dropped. */
  readonly report = (percent: number): void => {
    const value = Math.min(100, Math.max(0, Math.floor(percent)));
    const now = this.now();
    if (this.stopped || this.inFlight || value <= this.lastSent) return;
    if (now - this.lastAt < this.options.intervalMs) return;

    this.inFlight = true;
    this.lastAt = now;
    this.send(value)
      .then(
        () => {
          this.lastSent = value;
        },
        (err: unknown) => {
          if (err instanceof MetadataError && !err.retryable) this.stopped = true;
          this.logger.debug(`progress ${value}% not recorded: ${(err as Error).message}`);
        },
      )
      .finally(() => {
        this.inFlight = false;
      });
  };
}
