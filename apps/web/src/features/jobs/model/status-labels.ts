import { type Tone } from '../../../shared/ui/tone';
import { type JobStatus } from './types';

/** Static keys in the `jobs` namespace, so they stay greppable. */
export const STATUS_LABEL_KEY = {
  queued: 'status.queued',
  scheduled: 'status.scheduled',
  running: 'status.running',
  succeeded: 'status.succeeded',
  failed: 'status.failed',
  dead: 'status.dead',
} as const satisfies Record<JobStatus, string>;

export const STATUS_TONE = {
  queued: 'neutral',
  scheduled: 'neutral',
  running: 'progress',
  succeeded: 'success',
  failed: 'danger',
  dead: 'danger',
} as const satisfies Record<JobStatus, Tone>;
