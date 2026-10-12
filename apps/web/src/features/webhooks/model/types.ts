/** Mirrors the gateway contract for `/v1/webhooks`. */
export const WEBHOOK_EVENTS = ['job.succeeded', 'job.dead'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_MAX_ENDPOINTS = 5;

export type Webhook = {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: string;
};

/** The secret comes back only once, in the response to the create request. */
export type CreatedWebhook = Webhook & { secret: string };

export type CreateWebhookArgs = { url: string; events: readonly WebhookEvent[] };

export type DeliveryStatus = 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'dead';

export type Delivery = {
  /** Job id of the delivery itself; redrive uses it. */
  id: string;
  messageId: string;
  event: WebhookEvent;
  /** The job the delivery reports on. */
  jobId: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  deadReason: 'permanent' | 'exhausted' | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryPage = { items: Delivery[]; nextCursor: string | null };

export const isSettled = (status: DeliveryStatus): boolean =>
  status === 'succeeded' || status === 'dead';
