export const JOB_STATUSES = [
  'queued',
  'scheduled',
  'running',
  'succeeded',
  'failed',
  'dead',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const FILTERABLE_STATUSES = ['queued', 'running', 'succeeded', 'dead'] as const;
export type JobStatusFilter = (typeof FILTERABLE_STATUSES)[number];

/** `permanent`: the input cannot be processed; `exhausted`: every attempt failed. */
export type DeadReason = 'permanent' | 'exhausted';

const TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'dead'];
export const isTerminal = (status: JobStatus): boolean => TERMINAL.includes(status);

export type JobResult = {
  preset: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
};

export type Job = {
  id: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  deadReason: DeadReason | null;
  results?: JobResult[];
  createdAt: string;
};

export type JobPage = {
  items: Job[];
  nextCursor: string | null;
};
