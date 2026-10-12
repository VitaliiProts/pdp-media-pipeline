export const JOB_STATUSES = [
  'queued',
  'scheduled',
  'running',
  'succeeded',
  'failed',
  'dead',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const FILTERABLE_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatusFilter = (typeof FILTERABLE_STATUSES)[number];

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
  results?: JobResult[];
  createdAt: string;
};

export type JobPage = {
  items: Job[];
  nextCursor: string | null;
};
