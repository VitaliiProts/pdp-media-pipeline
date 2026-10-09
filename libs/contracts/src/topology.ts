import { z } from 'zod';
import {
  type JobClass,
  JobClassSchema,
  JobPrioritySchema,
  JobTypeSchema,
  type JobType,
} from './jobs';

/** Streams and their subjects. Every service declares the ones it touches on startup. */
export const STREAMS = {
  EVENTS: { name: 'EVENTS', subjects: ['events.>'], retention: 'limits' },
  JOBS_CPU: { name: 'JOBS_CPU', subjects: ['jobs.cpu.>'], retention: 'workqueue' },
  JOBS_IO: { name: 'JOBS_IO', subjects: ['jobs.io.>'], retention: 'workqueue' },
  JOBS_PRIORITY: { name: 'JOBS_PRIORITY', subjects: ['jobs.priority.>'], retention: 'workqueue' },
} as const;

export type StreamName = keyof typeof STREAMS;

export const STREAM_BY_CLASS: Record<JobClass, StreamName> = {
  cpu: 'JOBS_CPU',
  io: 'JOBS_IO',
  priority: 'JOBS_PRIORITY',
};

export const dispatchSubject = (jobClass: JobClass, type: JobType): string =>
  `jobs.${jobClass}.${type}`;

/** `Nats-Msg-Id` for dispatch: a redelivered job.created must not enqueue the job twice. */
export const dispatchMessageId = (jobId: string): string => `dispatch:${jobId}`;

/**
 * Command sent to a class stream. Unlike events, it has exactly one consumer
 * and lives under `jobs.*`.
 */
export const JobDispatchV1 = z.object({
  version: z.literal(1),
  jobId: z.uuid(),
  type: JobTypeSchema,
  class: JobClassSchema,
  priority: JobPrioritySchema,
  input: z.record(z.string(), z.unknown()),
  dispatchedAt: z.iso.datetime(),
});
export type JobDispatchV1 = z.infer<typeof JobDispatchV1>;

export const WORKER_MAX_DELIVER = 3;
