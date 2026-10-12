import { Logger } from '@nestjs/common';
import {
  dispatchMessageId,
  imageResultKey,
  ImageResizeInputV1,
  type ImageResizeOutputV1,
  type ImagePreset,
  JobDispatchV1,
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
import { PermanentError } from '../image/permanent-error';
import { type ResizedImage } from '../image/resize';

export interface ImageResizeDeps {
  transition: (jobId: string, body: TransitionRequest) => Promise<TransitionResponse>;
  getObject: (key: string) => Promise<Buffer>;
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
  resize: (input: Buffer, presets: readonly ImagePreset[]) => Promise<ResizedImage[]>;
}

export interface ImageResizeOptions {
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
 * Status changes go through Metadata synchronously and the message is acked only
 * after Metadata confirmed the outcome; when Metadata is unavailable it is nak'ed.
 *
 * The worker does not decide when to give up: Metadata counts attempts and answers a
 * start or retry over the limit with `dead`, which the worker then acks.
 */
export class ImageResizeHandler {
  private readonly logger = new Logger(ImageResizeHandler.name);
  private readonly actor: string;

  constructor(
    private readonly deps: ImageResizeDeps,
    private readonly options: ImageResizeOptions,
  ) {
    this.actor = `worker:${options.workerId}`;
  }

  async handle(msg: DeliveredMessage): Promise<HandlerResult> {
    const parsed = this.parse(msg.data);
    if ('reason' in parsed) return term(parsed.reason);
    const { dispatch, input } = parsed;
    const { jobId } = dispatch;
    const attempt = dispatch.attemptBase + msg.deliveryCount;
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

    let output: ImageResizeOutputV1;
    try {
      output = await this.process(jobId, input);
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

  private parse(
    data: Uint8Array,
  ): { dispatch: JobDispatchV1; input: ImageResizeInputV1 } | { reason: string } {
    try {
      const dispatch = JobDispatchV1.parse(JSON.parse(new TextDecoder().decode(data)));
      if (dispatch.type !== 'image.resize') {
        return { reason: `unexpected job type ${dispatch.type}` };
      }
      return { dispatch, input: ImageResizeInputV1.parse(dispatch.input) };
    } catch (err) {
      return { reason: `invalid dispatch: ${(err as Error).message}` };
    }
  }

  private async process(jobId: string, input: ImageResizeInputV1): Promise<ImageResizeOutputV1> {
    const source = await this.deps.getObject(input.sourceKey);
    const images = await this.deps.resize(source, input.presets);
    const results = await Promise.all(
      images.map(async (image) => {
        const key = imageResultKey(jobId, image.preset);
        await this.deps.putObject(key, image.data, 'image/webp');
        return {
          preset: image.preset,
          key,
          width: image.width,
          height: image.height,
          bytes: image.data.length,
        };
      }),
    );
    return { results };
  }

  private async onProcessingError(
    err: unknown,
    jobId: string,
    attempt: number,
    inbox: TransitionRequest['inbox'],
    retryDelay: number,
  ): Promise<HandlerResult> {
    const message = (err as Error).message.slice(0, 2000);
    const permanent = err instanceof PermanentError;
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
