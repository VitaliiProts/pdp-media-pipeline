import { Logger } from '@nestjs/common';
import {
  dispatchMessageId,
  JobDispatchV1,
  type JobType,
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
import { traced, withJobContext } from '@pdp/observability';
import { trace } from '@opentelemetry/api';
import { type z } from 'zod';
import { isPermanentError } from './permanent-error';

export interface JobContext {
  jobId: string;
  attempt: number;
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
}

export interface JobRunnerOptions {
  workerId: string;
  retry: BackoffOptions;
}

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
 * Metadata confirmed the outcome; when Metadata is unavailable it is nak'ed.
 *
 * The worker does not decide when to give up: Metadata counts attempts and answers a
 * start or retry over the limit with `dead`, which the worker then acks.
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

  async handle(msg: DeliveredMessage): Promise<HandlerResult> {
    const parsed = this.parse(msg.data);
    if ('reason' in parsed) return term(parsed.reason);
    const { dispatch } = parsed;
    // The scheduler already set this baggage; set again for dispatches published without it.
    return withJobContext({ id: dispatch.jobId, type: dispatch.type, class: dispatch.class }, () =>
      this.run(msg, parsed),
    );
  }

  private async run(
    msg: DeliveredMessage,
    { dispatch, input, processor }: ParsedDispatch,
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
      const started = await this.deps.transition(jobId, {
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
    try {
      output = await traced(
        `job process ${dispatch.type}`,
        { attributes: { 'job.attempt': attempt } },
        () => processor.process({ jobId, attempt }, input),
      );
    } catch (err) {
      return this.onProcessingError(err, jobId, attempt, inbox, retryDelay);
    }

    try {
      await this.deps.transition(jobId, {
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
        await this.deps.transition(jobId, {
          to: 'dead',
          attempt,
          actor: this.actor,
          error: message,
          inbox,
        });
        return ack();
      }
      const res = await this.deps.transition(jobId, {
        to: 'scheduled',
        attempt,
        actor: this.actor,
        error: message,
      });
      if (res.job.status === 'dead') return ack();
      this.logger.log(`job ${jobId} retries in ${retryDelay}ms`);
      return nak(retryDelay);
    } catch (transitionErr) {
      return this.onMetadataError(transitionErr, jobId, retryDelay);
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
