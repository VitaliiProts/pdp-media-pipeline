import { z } from 'zod';
import {
  DeadReasonSchema,
  JobClassSchema,
  JobPrioritySchema,
  JobStatusSchema,
  JobTypeSchema,
} from './jobs';
import { SOURCE_URL_MAX_LENGTH } from './source';
import { WebhookEventSchema } from './webhooks';

/** Internal REST API of the Metadata service, shared by the server and its clients. */

export const JobProgressSchema = z.number().int().min(0).max(100);

export const JobDto = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: JobTypeSchema,
  class: JobClassSchema.nullable(),
  status: JobStatusSchema,
  priority: JobPrioritySchema,
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  attempts: z.number().int().min(0),
  /** Attempts up to and including this number belong to earlier generations (before a redrive). */
  attemptBase: z.number().int().min(0),
  deadReason: DeadReasonSchema.nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /** Absent in responses stored before tracing; null when tracing is off. */
  traceId: z.string().nullable().default(null),
  /** Percent of the current attempt, for long jobs that report it; reset when one starts. */
  progress: JobProgressSchema.nullable().default(null),
});
export type JobDto = z.infer<typeof JobDto>;

export const CreateJobRequest = z.object({
  userId: z.uuid(),
  type: JobTypeSchema,
  priority: JobPrioritySchema.optional(),
  input: z.record(z.string(), z.unknown()),
  /** Present when the client sent `Idempotency-Key`; the hash identifies the request body. */
  idempotency: z
    .object({ key: z.string().min(1).max(255), requestHash: z.string().length(64) })
    .optional(),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequest>;

export const CreateJobResponse = z.object({
  /** As it was when the job was created; a replay returns the same snapshot. */
  job: JobDto,
  replayed: z.boolean(),
});
export type CreateJobResponse = z.infer<typeof CreateJobResponse>;

export const ListJobsQuery = z.object({
  userId: z.uuid(),
  status: JobStatusSchema.optional(),
  /** Comma-separated in the query string. */
  types: z
    .union([z.array(JobTypeSchema), z.string().transform((s) => s.split(','))])
    .pipe(z.array(JobTypeSchema).min(1))
    .optional(),
  /** Deliveries to one endpoint; implies `types = [webhook.deliver]`. */
  webhookEndpointId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
/** Caller-side shape; the schema also coerces query-string values on the server. */
export type ListJobsQuery = Omit<z.output<typeof ListJobsQuery>, 'limit'> & { limit?: number };

export const ListJobsResponse = z.object({
  items: z.array(JobDto),
  nextCursor: z.string().nullable(),
});
export type ListJobsResponse = z.infer<typeof ListJobsResponse>;

export const TRANSITION_TARGETS = ['scheduled', 'running', 'succeeded', 'dead'] as const;
export const TransitionTargetSchema = z.enum(TRANSITION_TARGETS);
export type TransitionTarget = z.infer<typeof TransitionTargetSchema>;

/**
 * Idempotency key is (jobId, attempt, to). The scheduler reports `attempt = attemptBase`,
 * workers `attemptBase + msg.info.deliveryCount`.
 *
 * A worker asks for `scheduled` to retry and `dead` for a permanent failure; Metadata may
 * turn a retry or a start into `dead` when the attempts are used up, so callers check the
 * returned job status.
 */
export const TransitionRequest = z.object({
  to: TransitionTargetSchema,
  attempt: z.number().int().min(0),
  actor: z.string().min(1),
  class: JobClassSchema.optional(),
  error: z.string().max(2000).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  /** The delivered message; recorded with a final transition so a redelivery is recognised. */
  inbox: z.object({ consumer: z.string().min(1), messageId: z.string().min(1) }).optional(),
  /**
   * With `to: 'scheduled'`: the worker is shutting down and hands the job back unfinished.
   * The attempt does not count towards the limit, since the job did nothing wrong.
   */
  interrupted: z.boolean().optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const TransitionResponse = z.object({
  applied: z.boolean(),
  job: JobDto,
});
export type TransitionResponse = z.infer<typeof TransitionResponse>;

/**
 * Accepted only while the job is `running` and `attempt` is its latest one, so a stale
 * worker cannot overwrite the progress of the attempt that replaced it.
 */
export const ProgressRequest = z.object({
  attempt: z.number().int().min(1),
  progress: JobProgressSchema,
});
export type ProgressRequest = z.infer<typeof ProgressRequest>;

export const RedriveRequest = z.object({ actor: z.string().min(1) });
export type RedriveRequest = z.infer<typeof RedriveRequest>;

export const ResolveApiKeyRequest = z.object({ apiKeyHash: z.string().length(64) });
export const ResolveApiKeyResponse = z.object({ userId: z.uuid() });

export const WebhookEndpointDto = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  url: z.url(),
  events: z.array(WebhookEventSchema).min(1),
  createdAt: z.iso.datetime(),
});
export type WebhookEndpointDto = z.infer<typeof WebhookEndpointDto>;

/** Only returned on creation and to the delivering worker; never listed. */
export const WebhookEndpointWithSecretDto = WebhookEndpointDto.extend({ secret: z.string() });
export type WebhookEndpointWithSecretDto = z.infer<typeof WebhookEndpointWithSecretDto>;

export const CreateWebhookEndpointRequest = z.object({
  userId: z.uuid(),
  url: z.url({ protocol: /^https?$/ }).max(SOURCE_URL_MAX_LENGTH),
  events: z
    .array(WebhookEventSchema)
    .min(1)
    .refine((e) => new Set(e).size === e.length, 'events must be unique'),
});
export type CreateWebhookEndpointRequest = z.infer<typeof CreateWebhookEndpointRequest>;

export const ListWebhookEndpointsResponse = z.object({ items: z.array(WebhookEndpointDto) });
export type ListWebhookEndpointsResponse = z.infer<typeof ListWebhookEndpointsResponse>;

export const METADATA_ERROR_CODES = [
  'VALIDATION_FAILED',
  'JOB_NOT_FOUND',
  'API_KEY_NOT_FOUND',
  'JOB_TERMINAL',
  'STALE_ATTEMPT',
  'INVALID_TRANSITION',
  'DUPLICATE_DELIVERY',
  'NOT_REDRIVABLE',
  'IDEMPOTENCY_KEY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REUSED',
  'WEBHOOK_NOT_FOUND',
  'WEBHOOK_LIMIT_REACHED',
  'USER_NOT_FOUND',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'API_KEY_LIMIT_REACHED',
] as const;
export type MetadataErrorCode = (typeof METADATA_ERROR_CODES)[number];

export const MetadataErrorBody = z.object({
  code: z.enum(METADATA_ERROR_CODES),
  message: z.string(),
});
export type MetadataErrorBody = z.infer<typeof MetadataErrorBody>;
