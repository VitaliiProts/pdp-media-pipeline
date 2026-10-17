import { z } from 'zod';

export const MEDIA_JOB_TYPES = [
  'image.resize',
  'video.frames',
  'video.transcode',
  'video.dub',
] as const;
export const JOB_TYPES = [...MEDIA_JOB_TYPES, 'webhook.deliver'] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;
export type MediaJobType = (typeof MEDIA_JOB_TYPES)[number];

/** Jobs the user submits; the rest (webhook deliveries) are created by the pipeline itself. */
export const isMediaJobType = (type: JobType): type is MediaJobType =>
  (MEDIA_JOB_TYPES as readonly JobType[]).includes(type);

export const JOB_CLASSES = ['io', 'cpu', 'priority'] as const;
export const JobClassSchema = z.enum(JOB_CLASSES);
export type JobClass = z.infer<typeof JobClassSchema>;

export const JOB_STATUSES = [
  'queued',
  'scheduled',
  'running',
  'succeeded',
  'failed',
  'dead',
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['succeeded', 'failed', 'dead'];

/** Why a job is `dead`: retrying cannot help, or every allowed attempt failed. */
export const DEAD_REASONS = ['permanent', 'exhausted'] as const;
export const DeadReasonSchema = z.enum(DEAD_REASONS);
export type DeadReason = z.infer<typeof DeadReasonSchema>;

export const isTerminalStatus = (status: JobStatus): boolean =>
  TERMINAL_JOB_STATUSES.includes(status);

export const JobPrioritySchema = z.number().int().min(0).max(9);
export type JobPriority = z.infer<typeof JobPrioritySchema>;
export const DEFAULT_JOB_PRIORITY = 5;
