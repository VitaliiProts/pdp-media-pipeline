import { isTerminalStatus, type JobStatus, type TransitionTarget } from '@pdp/contracts';

export interface JobState {
  status: JobStatus;
  /** Highest attempt that has started. */
  attempts: number;
}

export interface TransitionInput {
  to: TransitionTarget;
  attempt: number;
}

/** What the transition does to `job_executions` and the job row besides the status. */
export type TransitionEffect = 'schedule' | 'start' | 'retry' | 'succeed' | 'fail';

export type RejectCode = 'JOB_TERMINAL' | 'STALE_ATTEMPT' | 'INVALID_TRANSITION';

export type Decision =
  | { kind: 'apply'; from: JobStatus; to: TransitionTarget; effect: TransitionEffect }
  | { kind: 'noop'; reason: 'duplicate' | 'overtaken' }
  | { kind: 'reject'; code: RejectCode; message: string };

const reject = (code: RejectCode, message: string): Decision => ({ kind: 'reject', code, message });

/**
 * The single place that decides whether a status change is allowed.
 * Attempt 0 belongs to the scheduler, attempts >= 1 are NATS delivery counts of the worker.
 *
 * @param alreadyApplied the same (jobId, attempt, to) is already in job_transitions
 */
export function decide(job: JobState, req: TransitionInput, alreadyApplied: boolean): Decision {
  if (alreadyApplied) return { kind: 'noop', reason: 'duplicate' };

  const { status, attempts } = job;
  const { to, attempt } = req;
  const apply = (effect: TransitionEffect): Decision => ({
    kind: 'apply',
    from: status,
    to,
    effect,
  });

  if (to === 'scheduled' && attempt === 0) {
    // The scheduler may report after the worker has already started or finished the job.
    return status === 'queued' ? apply('schedule') : { kind: 'noop', reason: 'overtaken' };
  }

  if (isTerminalStatus(status)) {
    return reject('JOB_TERMINAL', `job is already ${status}`);
  }

  if (attempt === 0) {
    return reject('INVALID_TRANSITION', `attempt 0 is reserved for scheduling, got ${to}`);
  }

  switch (to) {
    case 'running':
      if (attempt <= attempts) {
        return reject('STALE_ATTEMPT', `attempt ${attempt} is not newer than ${attempts}`);
      }
      // From queued (worker overtook the scheduler), scheduled, or running (previous attempt abandoned).
      return apply('start');

    case 'scheduled':
      // A worker hands the job back for a retry.
      if (status !== 'running') {
        return reject('INVALID_TRANSITION', `cannot retry a ${status} job`);
      }
      if (attempt < attempts) return reject('STALE_ATTEMPT', `attempt ${attempt} < ${attempts}`);
      if (attempt > attempts)
        return reject('INVALID_TRANSITION', `attempt ${attempt} never started`);
      return apply('retry');

    case 'succeeded':
      if (attempt > attempts)
        return reject('INVALID_TRANSITION', `attempt ${attempt} never started`);
      if (status === 'queued') return reject('INVALID_TRANSITION', 'job never started');
      // First success wins, even from an older attempt: results are written to deterministic keys.
      return apply('succeed');

    case 'failed':
      if (status !== 'running') return reject('INVALID_TRANSITION', `cannot fail a ${status} job`);
      if (attempt < attempts) return reject('STALE_ATTEMPT', `attempt ${attempt} < ${attempts}`);
      if (attempt > attempts)
        return reject('INVALID_TRANSITION', `attempt ${attempt} never started`);
      return apply('fail');
  }
}
