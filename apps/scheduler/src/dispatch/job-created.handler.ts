import { Logger } from '@nestjs/common';
import {
  dispatchMessageId,
  dispatchSubject,
  JobCreatedV1,
  type JobClass,
  type JobDispatchV1,
  selectClass,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { ack, type HandlerResult, nak, term } from '@pdp/messaging';
import { MetadataError } from '@pdp/metadata-client';
import { jobMetrics, withJobContext } from '@pdp/observability';

export const SCHEDULER_ACTOR = 'scheduler';
export const RETRY_DELAY_MS = 2000;

export interface JobCreatedDeps {
  publish: (subject: string, data: JobDispatchV1, msgId: string) => Promise<{ duplicate: boolean }>;
  transition: (jobId: string, body: TransitionRequest) => Promise<TransitionResponse>;
}

/**
 * Publishes the dispatch first, then marks the job `scheduled`. If the transition
 * fails, the redelivered event republishes under the same `Nats-Msg-Id` and
 * JetStream drops the copy, so the job is never enqueued twice within the window.
 * A redrive carries a new `attemptBase`, which makes a new id and a new dispatch.
 */
export class JobCreatedHandler {
  private readonly logger = new Logger(JobCreatedHandler.name);

  constructor(private readonly deps: JobCreatedDeps) {}

  async handle(data: Uint8Array): Promise<HandlerResult> {
    let event: JobCreatedV1;
    try {
      event = JobCreatedV1.parse(JSON.parse(new TextDecoder().decode(data)));
    } catch (err) {
      return term(`invalid job.created: ${(err as Error).message}`);
    }

    const { type, priority } = event.payload;
    const jobClass = selectClass({ type, priority });
    return withJobContext({ id: event.payload.jobId, type, class: jobClass }, () =>
      this.dispatch(event.payload, jobClass),
    );
  }

  private async dispatch(
    { jobId, type, priority, input, attemptBase }: JobCreatedV1['payload'],
    jobClass: JobClass,
  ): Promise<HandlerResult> {
    const dispatch: JobDispatchV1 = {
      version: 1,
      jobId,
      type,
      class: jobClass,
      priority,
      input,
      attemptBase,
      dispatchedAt: new Date().toISOString(),
    };

    try {
      const ack = await this.deps.publish(
        dispatchSubject(jobClass, type),
        dispatch,
        dispatchMessageId(jobId, attemptBase),
      );
      if (ack.duplicate) jobMetrics.duplicate('dispatch');
    } catch (err) {
      this.logger.warn(`dispatch publish failed for ${jobId}: ${(err as Error).message}`);
      return nak(RETRY_DELAY_MS);
    }

    try {
      await this.deps.transition(jobId, {
        to: 'scheduled',
        attempt: attemptBase,
        actor: SCHEDULER_ACTOR,
        class: jobClass,
      });
      return ack();
    } catch (err) {
      if (!(err instanceof MetadataError)) throw err;
      if (err.retryable) return nak(RETRY_DELAY_MS);
      if (err.status === 409) return ack();
      if (err.status === 404) return term(`job ${jobId} not found`);
      return term(`transition rejected: ${err.status} ${err.code ?? ''} ${err.message}`);
    }
  }
}
