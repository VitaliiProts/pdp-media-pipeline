import {
  signWebhook,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WebhookDeliverInputV1,
  type WebhookDeliverOutputV1,
  type WebhookEndpointWithSecretDto,
} from '@pdp/contracts';
import { trace } from '@opentelemetry/api';
import { classifyStatus, type EgressRequest, type EgressResponse } from '@pdp/egress';
import { type JobContext, type JobProcessor, PermanentError } from '@pdp/worker-kit';

export interface WebhookDeliverDeps {
  /** `null` when the endpoint was deleted after the delivery was queued. */
  getEndpoint: (id: string) => Promise<WebhookEndpointWithSecretDto | null>;
  request: (url: string, req: EgressRequest) => Promise<EgressResponse>;
  now?: () => number;
}

export interface WebhookDeliverOptions {
  timeoutMs: number;
}

/** Receivers answer with a status; anything they put in the body is irrelevant to us. */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * One POST per attempt, signed at send time so `webhook-timestamp` stays fresh across
 * retries while `webhook-id` stays the same. Retries, backoff and the DLQ come from the
 * job runner like for any other job.
 */
export class WebhookDeliverProcessor implements JobProcessor<WebhookDeliverInputV1> {
  readonly type = 'webhook.deliver';
  readonly inputSchema = WebhookDeliverInputV1;
  private readonly now: () => number;

  constructor(
    private readonly deps: WebhookDeliverDeps,
    private readonly options: WebhookDeliverOptions,
  ) {
    this.now = deps.now ?? Date.now;
  }

  async process(_job: JobContext, input: WebhookDeliverInputV1): Promise<WebhookDeliverOutputV1> {
    trace.getActiveSpan()?.setAttributes({
      'webhook.endpoint_id': input.endpointId,
      'webhook.message_id': input.messageId,
      'webhook.event': input.payload.type,
    });
    const endpoint = await this.deps.getEndpoint(input.endpointId);
    if (!endpoint) throw new PermanentError(`endpoint ${input.endpointId} no longer exists`);

    const body = JSON.stringify(input.payload);
    const started = this.now();
    const timestamp = Math.floor(started / 1000);
    const res = await this.deps.request(endpoint.url, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_ID_HEADER]: input.messageId,
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
        [WEBHOOK_SIGNATURE_HEADER]: signWebhook({
          secret: endpoint.secret,
          id: input.messageId,
          timestamp,
          body,
        }),
      },
      timeoutMs: this.options.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
    });

    const outcome = classifyStatus(res.status);
    if (outcome === 'success') {
      return { statusCode: res.status, durationMs: Math.max(0, this.now() - started) };
    }
    const message = `endpoint responded ${res.status}`;
    throw outcome === 'permanent' ? new PermanentError(message) : new Error(message);
  }
}
