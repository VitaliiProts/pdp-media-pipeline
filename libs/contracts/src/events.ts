import { z } from 'zod';
import { defineEvent, type EventOf } from './envelope';
import { JobClassSchema, JobPrioritySchema, JobStatusSchema, JobTypeSchema } from './jobs';

export const JobCreatedV1 = defineEvent(
  'job.created',
  1,
  z.object({
    jobId: z.uuid(),
    userId: z.uuid(),
    type: JobTypeSchema,
    priority: JobPrioritySchema,
    input: z.record(z.string(), z.unknown()),
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
