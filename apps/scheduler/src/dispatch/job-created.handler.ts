import { Logger } from '@nestjs/common';
import {
  dispatchMessageId,
  dispatchSubject,
  JobCreatedV1,
  type JobDispatchV1,
  selectClass,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { ack, type HandlerResult, nak, term } from '@pdp/messaging';
import { MetadataError } from '@pdp/metadata-client';

export const SCHEDULER_ACTOR = 'scheduler';
export const RETRY_DELAY_MS = 2000;

export interface JobCreatedDeps {
  publish: (subject: string, data: JobDispatchV1, msgId: string) => Promise<unknown>;
  transition: (jobId: string, body: TransitionRequest) => Promise<TransitionResponse>;
}

/**
 * Publishes the dispatch first, then marks the job `scheduled`. If the transition
 * fails, the redelivered event republishes under the same `Nats-Msg-Id` and
 * JetStream drops the copy, so the job is never enqueued twice within the window.
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

    const { jobId, type, priority, input } = event.payload;
    const jobClass = selectClass({ type, priority });
    const dispatch: JobDispatchV1 = {
      version: 1,
      jobId,
      type,
      class: jobClass,
      priority,
      input,
      dispatchedAt: new Date().toISOString(),
    };

    try {
      await this.deps.publish(dispatchSubject(jobClass, type), dispatch, dispatchMessageId(jobId));
    } catch (err) {
      this.logger.warn(`dispatch publish failed for ${jobId}: ${(err as Error).message}`);
      return nak(RETRY_DELAY_MS);
    }

    try {
      await this.deps.transition(jobId, {
        to: 'scheduled',
        attempt: 0,
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
