import { z } from 'zod';
import {
  DeadReasonSchema,
  JobClassSchema,
  JobPrioritySchema,
  JobStatusSchema,
  JobTypeSchema,
} from './jobs';

/** Internal REST API of the Metadata service, shared by the server and its clients. */

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
});
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const TransitionResponse = z.object({
  applied: z.boolean(),
  job: JobDto,
});
export type TransitionResponse = z.infer<typeof TransitionResponse>;

export const RedriveRequest = z.object({ actor: z.string().min(1) });
export type RedriveRequest = z.infer<typeof RedriveRequest>;

export const ResolveApiKeyRequest = z.object({ apiKeyHash: z.string().length(64) });
export const ResolveApiKeyResponse = z.object({ userId: z.uuid() });

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
] as const;
export type MetadataErrorCode = (typeof METADATA_ERROR_CODES)[number];

export const MetadataErrorBody = z.object({
  code: z.enum(METADATA_ERROR_CODES),
  message: z.string(),
});
export type MetadataErrorBody = z.infer<typeof MetadataErrorBody>;
