import { Logger } from '@nestjs/common';
import {
  dispatchMessageId,
  JobDispatchV1,
  type JobType,
  type ProgressRequest,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import {
  ack,
  type BackoffOptions,
  fullJitterDelay,
  type HandlerResult,
  nak,
  term,
} from '@pdp/messaging';
import { MetadataError } from '@pdp/metadata-client';
import { jobMetrics, traced, withJobContext } from '@pdp/observability';
import { trace } from '@opentelemetry/api';
import { setTimeout as delay } from 'node:timers/promises';
import { type z } from 'zod';
import { isPermanentError } from './permanent-error';
import { ProgressReporter } from './progress';

export interface JobContext {
  jobId: string;
  attempt: number;
  /**
   * Percent done, as often as convenient: updates are throttled and never block. A job made
   * of several steps names the current one; the percent is still that of the whole job.
   */
  progress: (percent: number, step?: string) => void;
  /**
   * Aborts when the worker shuts down and stops waiting for this job. Pass it to whatever
   * runs long; the error it causes hands the job back without using up an attempt.
   */
  signal: AbortSignal;
}

export type JobOutput = Record<string, unknown>;

/**
 * Work for one job type. `process` must be safe to repeat: a job can run again after a
 * crash or a lost ack, so results go to deterministic keys. Throw a `PermanentError`
 * (or any error with `permanent: true`) when retrying cannot help.
 */
export interface JobProcessor<I> {
  readonly type: JobType;
  readonly inputSchema: z.ZodType<I>;
  process(job: JobContext, input: I): Promise<JobOutput>;
}

interface RegisteredProcessor {
  parse(input: unknown): unknown;
  process(job: JobContext, input: unknown): Promise<JobOutput>;
}

interface ParsedDispatch {
  dispatch: JobDispatchV1;
  input: unknown;
  processor: RegisteredProcessor;
}

export interface JobRunnerDeps {
  transition: (jobId: string, body: TransitionRequest) => Promise<TransitionResponse>;
  /** Without it `JobContext.progress` does nothing. */
  progress?: (jobId: string, body: ProgressRequest) => Promise<void>;
}

export interface TransitionRetryOptions {
  /** Further tries of a transition Metadata did not answer, with the same attempt. */
  repeats: number;
  /** Before the first repeat, doubling after it. */
  delayMs: number;
}

export interface JobRunnerOptions {
  workerId: string;
  retry: BackoffOptions;
  /** Minimum time between two progress updates of one attempt; 3 s by default. */
  progressIntervalMs?: number;
  /** 3 repeats after 0.5, 1 and 2 s by default. */
  transitionRetry?: TransitionRetryOptions;
}

const DEFAULT_PROGRESS_INTERVAL_MS = 3000;
const DEFAULT_TRANSITION_RETRY: TransitionRetryOptions = { repeats: 3, delayMs: 500 };

export interface DeliveredMessage {
  data: Uint8Array;
  /** 1 on first delivery of this dispatch. */
  deliveryCount: number;
  /** Durable consumer the message came from; scopes the inbox entry. */
  consumer: string;
}

/**
 * Drives one delivered dispatch through Metadata: `running`, the processor, then `succeeded`,
 * `dead` (permanent error) or `scheduled` with a jittered `nak` (transient error).
 *
 * Status changes go through Metadata synchronously and the message is acked only after
 * Metadata confirmed the outcome. One Metadata did not answer is repeated with the same
 * attempt, which it applies at most once; only then is the message nak'ed, as a nak comes
 * back as the next attempt and uses one up even when the change went through.
 *
 * The worker does not decide when to give up: Metadata counts attempts and answers a
 * start or retry over the limit with `dead`, which the worker then acks.
 *
 * A job that fails after `signal` aborted was cut short by a shutdown: it goes back as
 * `scheduled` with `interrupted`, which Metadata does not count, and is nak'ed at once.
 */
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private readonly actor: string;
  private readonly processors = new Map<JobType, RegisteredProcessor>();

  constructor(
    private readonly deps: JobRunnerDeps,
    private readonly options: JobRunnerOptions,
  ) {
    this.actor = `worker:${options.workerId}`;
  }

  register<I>(processor: JobProcessor<I>): this {
    this.processors.set(processor.type, {
      parse: (input) => processor.inputSchema.parse(input),
      process: (job, input) => processor.process(job, input as I),
    });
    return this;
  }

  async handle(
    msg: DeliveredMessage,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<HandlerResult> {
    const parsed = this.parse(msg.data);
    if ('reason' in parsed) return term(parsed.reason);
    const { dispatch } = parsed;
    // The scheduler already set this baggage; set again for dispatches published without it.
    return withJobContext({ id: dispatch.jobId, type: dispatch.type, class: dispatch.class }, () =>
      this.run(msg, parsed, signal),
    );
  }

  private async run(
    msg: DeliveredMessage,
    { dispatch, input, processor }: ParsedDispatch,
    signal: AbortSignal,
  ): Promise<HandlerResult> {
    const { jobId } = dispatch;
    const attempt = dispatch.attemptBase + msg.deliveryCount;
    trace.getActiveSpan()?.setAttribute('job.attempt', attempt);
    const retryDelay = fullJitterDelay(msg.deliveryCount, this.options.retry);
    const inbox = {
      consumer: msg.consumer,
      messageId: dispatchMessageId(jobId, dispatch.attemptBase),
    };

    try {
      const started = await this.transition(jobId, {
        to: 'running',
        attempt,
        actor: this.actor,
        class: dispatch.class,
        inbox,
      });
      if (started.job.status !== 'running') {
        this.logger.warn(
          `job ${jobId} is ${started.job.status}, not processing attempt ${attempt}`,
        );
        return ack();
      }
    } catch (err) {
      return this.onMetadataError(err, jobId, retryDelay);
    }

    let output: JobOutput;
    const startedAt = performance.now();
    const elapsed = () => (performance.now() - startedAt) / 1000;
    try {
      output = await traced(
        `job process ${dispatch.type}`,
        { attributes: { 'job.attempt': attempt } },
        () =>
          processor.process(
            { jobId, attempt, progress: this.progressOf(jobId, attempt), signal },
            input,
          ),
      );
      jobMetrics.attempt(dispatch.type, 'succeeded', elapsed());
    } catch (err) {
      if (signal.aborted) {
        jobMetrics.attempt(dispatch.type, 'interrupted', elapsed());
        return this.onInterrupted(jobId, attempt, retryDelay);
      }
      jobMetrics.attempt(dispatch.type, isPermanentError(err) ? 'failed' : 'retry', elapsed());
      return this.onProcessingError(err, jobId, attempt, inbox, retryDelay);
    }

    try {
      await this.transition(jobId, {
        to: 'succeeded',
        attempt,
        actor: this.actor,
        output,
        inbox,
      });
      return ack();
    } catch (err) {
      return this.onMetadataError(err, jobId, retryDelay);
    }
  }

  private async transition(jobId: string, body: TransitionRequest): Promise<TransitionResponse> {
    const { repeats, delayMs } = this.options.transitionRetry ?? DEFAULT_TRANSITION_RETRY;
    for (let n = 0; ; n++) {
      try {
        return await this.deps.transition(jobId, body);
      } catch (err) {
        if (!(err instanceof MetadataError) || !err.retryable || n >= repeats) throw err;
        await delay(delayMs * 2 ** n);
      }
    }
  }

  private progressOf(jobId: string, attempt: number): JobContext['progress'] {
    const send = this.deps.progress;
    if (!send) return () => undefined;
    return new ProgressReporter((progress, step) => send(jobId, { attempt, progress, step }), {
      intervalMs: this.options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS,
    }).report;
  }

  private parse(data: Uint8Array): ParsedDispatch | { reason: string } {
    try {
      const dispatch = JobDispatchV1.parse(JSON.parse(new TextDecoder().decode(data)));
      const processor = this.processors.get(dispatch.type);
      if (!processor) return { reason: `unexpected job type ${dispatch.type}` };
      return { dispatch, input: processor.parse(dispatch.input), processor };
    } catch (err) {
      return { reason: `invalid dispatch: ${(err as Error).message}` };
    }
  }

  private logDead(jobId: string, attempt: number, res: TransitionResponse, message: string): void {
    const { job } = res;
    // A redelivery of a job that is already dead gets `applied: false`.
    if (!res.applied || job.status !== 'dead') return;
    this.logger.error(
      `job ${jobId} is dead (${job.deadReason ?? 'unknown'}) after attempt ${attempt}: ${message}`,
    );
  }

  private async onProcessingError(
    err: unknown,
    jobId: string,
    attempt: number,
    inbox: TransitionRequest['inbox'],
    retryDelay: number,
  ): Promise<HandlerResult> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const permanent = isPermanentError(err);
    trace.getActiveSpan()?.setAttribute('job.error.permanent', permanent);
    this.logger.warn(
      `job ${jobId} attempt ${attempt} failed (${permanent ? 'permanent' : 'transient'}): ${message}`,
    );

    try {
      if (permanent) {
        const res = await this.transition(jobId, {
          to: 'dead',
          attempt,
          actor: this.actor,
          error: message,
          inbox,
        });
        this.logDead(jobId, attempt, res, message);
        return ack();
      }
      const res = await this.transition(jobId, {
        to: 'scheduled',
        attempt,
        actor: this.actor,
        error: message,
      });
      if (res.job.status === 'dead') {
        this.logDead(jobId, attempt, res, message);
        return ack();
      }
      const delay = this.delayFor(err, retryDelay);
      this.logger.log(`job ${jobId} retries in ${delay}ms`);
      return nak(delay);
    } catch (transitionErr) {
      return this.onMetadataError(transitionErr, jobId, retryDelay);
    }
  }

  /** An error may know better, e.g. a provider's `Retry-After` or an open circuit breaker. */
  private delayFor(err: unknown, retryDelay: number): number {
    const hinted = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs;
    if (typeof hinted !== 'number' || !Number.isFinite(hinted)) return retryDelay;
    return Math.max(retryDelay, Math.min(hinted, this.options.retry.maxMs));
  }

  private async onInterrupted(
    jobId: string,
    attempt: number,
    retryDelay: number,
  ): Promise<HandlerResult> {
    this.logger.log(`job ${jobId} attempt ${attempt} interrupted by shutdown, handing it back`);
    try {
      await this.transition(jobId, {
        to: 'scheduled',
        attempt,
        actor: this.actor,
        interrupted: true,
        error: 'interrupted: worker shutting down',
      });
      return nak(0);
    } catch (err) {
      return this.onMetadataError(err, jobId, retryDelay);
    }
  }

  private onMetadataError(err: unknown, jobId: string, retryDelay: number): HandlerResult {
    if (!(err instanceof MetadataError)) throw err;
    if (err.retryable) return nak(retryDelay);
    switch (err.code) {
      case 'JOB_TERMINAL':
      case 'STALE_ATTEMPT':
      case 'DUPLICATE_DELIVERY':
        this.logger.log(`job ${jobId}: ${err.code}, dropping this delivery`);
        return ack();
      case 'INVALID_TRANSITION':
        this.logger.error(`job ${jobId}: ${err.message}`);
        return term(err.message);
      default:
        return term(`metadata rejected job ${jobId}: ${err.status} ${err.message}`);
    }
  }
}
