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

export type VideoFrame = {
  atSeconds: number;
  width: number;
  height: number;
  bytes: number;
  url: string;
};

export type VideoResult = {
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  preview: VideoFrame;
  frames: VideoFrame[];
};

export type Rendition = {
  rendition: string;
  width: number;
  height: number;
  durationSeconds: number;
  bytes: number;
  /** Bits per second. */
  bitrate: number;
  url: string;
};

export type TranscodeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  preview: VideoFrame;
  renditions: Rendition[];
  skipped: string[];
};

export type Job = {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  deadReason: DeadReason | null;
  /** Percent, while running; only long job types report it. */
  progress?: number | null;
  results?: JobResult[];
  video?: VideoResult;
  transcode?: TranscodeResult;
  createdAt: string;
  /** Trace of the request that created or last redrove the job. */
  traceId: string | null;
};

export type JobPage = {
  items: Job[];
  nextCursor: string | null;
};
