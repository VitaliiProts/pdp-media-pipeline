import { z } from 'zod';
import { defineEvent, type EventOf } from './envelope';
import {
  DeadReasonSchema,
  JobClassSchema,
  JobPrioritySchema,
  JobStatusSchema,
  JobTypeSchema,
} from './jobs';

export const JobCreatedV1 = defineEvent(
  'job.created',
  1,
  z.object({
    jobId: z.uuid(),
    userId: z.uuid(),
    type: JobTypeSchema,
    priority: JobPrioritySchema,
    input: z.record(z.string(), z.unknown()),
    /** Non-zero after a redrive; worker attempts of this generation start above it. */
    attemptBase: z.number().int().min(0).default(0),
  }),
);
export type JobCreatedV1 = EventOf<typeof JobCreatedV1>;

export const JobStatusChangedV1 = defineEvent(
  'job.status_changed',
  1,
  z.object({
    jobId: z.uuid(),
    userId: z.uuid(),
    type: JobTypeSchema,
    from: JobStatusSchema,
    to: JobStatusSchema,
    class: JobClassSchema.nullable(),
    attempt: z.number().int().min(0),
    reason: z.string().optional(),
  }),
);
export type JobStatusChangedV1 = EventOf<typeof JobStatusChangedV1>;

/**
 * Written to `JOBS_DLQ` when a job becomes `dead`. Metadata stays the source of truth;
 * the stream is the operations feed of what failed and why.
 */
export const JobDeadLetteredV1 = defineEvent(
  'job.dead_lettered',
  1,
  z.object({
    jobId: z.uuid(),
    userId: z.uuid(),
    type: JobTypeSchema,
    class: JobClassSchema.nullable(),
    reason: DeadReasonSchema,
    attempts: z.number().int().min(0),
    lastError: z.string().nullable(),
    input: z.record(z.string(), z.unknown()),
  }),
);
export type JobDeadLetteredV1 = EventOf<typeof JobDeadLetteredV1>;
