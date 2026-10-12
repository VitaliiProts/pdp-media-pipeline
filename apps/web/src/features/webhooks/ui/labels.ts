import { type DeliveryStatus, type WebhookEvent } from '../model/types';

export const EVENT_LABEL_KEY = {
  'job.succeeded': 'event.succeeded',
  'job.dead': 'event.dead',
} as const satisfies Record<WebhookEvent, string>;

export const DELIVERY_STATUS_KEY = {
  queued: 'status.queued',
  scheduled: 'status.scheduled',
  running: 'status.running',
  succeeded: 'status.succeeded',
  failed: 'status.failed',
  dead: 'status.dead',
} as const satisfies Record<DeliveryStatus, string>;
