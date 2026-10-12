import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DeadReasonSchema, JobStatusSchema, JobTypeSchema } from './jobs';

/** Header names and signing scheme follow https://www.standardwebhooks.com. */
export const WEBHOOK_ID_HEADER = 'webhook-id';
export const WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

export const WEBHOOK_EVENTS = ['job.succeeded', 'job.dead'] as const;
export const WebhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WEBHOOK_MAX_ENDPOINTS_PER_USER = 5;
/** Receivers should reject older timestamps; signatures are made at send time, not at enqueue. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

const SECRET_PREFIX = 'whsec_';

export const WebhookPayloadV1 = z.object({
  type: WebhookEventSchema,
  timestamp: z.iso.datetime(),
  data: z.object({
    jobId: z.uuid(),
    jobType: JobTypeSchema,
    status: JobStatusSchema,
    attempts: z.number().int().min(0),
    deadReason: DeadReasonSchema.nullable(),
    lastError: z.string().nullable(),
    output: z.record(z.string(), z.unknown()).nullable(),
    finishedAt: z.iso.datetime().nullable(),
  }),
});
export type WebhookPayloadV1 = z.infer<typeof WebhookPayloadV1>;

export const WebhookDeliverInputV1 = z.object({
  endpointId: z.uuid(),
  /** Sent as `webhook-id`; stays the same across retries and redrives so receivers can dedupe. */
  messageId: z.string().startsWith('msg_'),
  payload: WebhookPayloadV1,
});
export type WebhookDeliverInputV1 = z.infer<typeof WebhookDeliverInputV1>;

export const WebhookDeliverOutputV1 = z.object({
  statusCode: z.number().int(),
  durationMs: z.number().int().min(0),
});
export type WebhookDeliverOutputV1 = z.infer<typeof WebhookDeliverOutputV1>;

export const generateWebhookSecret = (): string =>
  `${SECRET_PREFIX}${randomBytes(24).toString('base64')}`;

export const generateWebhookMessageId = (): string =>
  `msg_${randomBytes(16).toString('base64url')}`;

export const isWebhookSecret = (secret: string): boolean =>
  secret.startsWith(SECRET_PREFIX) && secret.length > SECRET_PREFIX.length;

function hmac(secret: string, id: string, timestamp: number, body: string): Buffer {
  const key = Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
}

/** Value of `webhook-signature`; `timestamp` is in Unix seconds. */
export function signWebhook(input: {
  secret: string;
  id: string;
  timestamp: number;
  body: string;
}): string {
  return `v1,${hmac(input.secret, input.id, input.timestamp, input.body).toString('base64')}`;
}

/** The header may carry several space-separated signatures, e.g. during secret rotation. */
export function verifyWebhook(input: {
  secret: string;
  id: string;
  timestamp: number;
  body: string;
  signatureHeader: string;
  nowSeconds?: number;
}): boolean {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) return false;
  const expected = hmac(input.secret, input.id, input.timestamp, input.body);
  return input.signatureHeader.split(' ').some((entry) => {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || !value) return false;
    const actual = Buffer.from(value, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
