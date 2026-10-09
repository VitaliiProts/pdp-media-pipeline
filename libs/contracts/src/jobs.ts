import { z } from 'zod';

export const JOB_TYPES = ['image.resize', 'video.frames', 'video.transcode'] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;

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

export const isTerminalStatus = (status: JobStatus): boolean =>
  TERMINAL_JOB_STATUSES.includes(status);

export const JobPrioritySchema = z.number().int().min(0).max(9);
export const DEFAULT_JOB_PRIORITY = 5;
