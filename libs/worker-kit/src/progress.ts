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
  private lastStep: string | undefined;
  private lastAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private stopped = false;

  constructor(
    private readonly send: (percent: number, step?: string) => Promise<void>,
    private readonly options: ProgressReporterOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Whole percent, clamped to 0..100; lower or equal values are dropped. A new step is sent
   * without waiting for the interval, since a job has only a few and each changes what the
   * user sees; the percent still never goes back.
   */
  readonly report = (percent: number, step?: string): void => {
    const newStep = step !== this.lastStep;
    const value = Math.max(this.lastSent, Math.min(100, Math.max(0, Math.floor(percent))));
    const now = this.now();
    if (this.stopped || this.inFlight) return;
    if (!newStep && (value <= this.lastSent || now - this.lastAt < this.options.intervalMs)) {
      return;
    }

    this.inFlight = true;
    this.lastAt = now;
    this.send(value, step)
      .then(
        () => {
          this.lastSent = value;
          this.lastStep = step;
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
