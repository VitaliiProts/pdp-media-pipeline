import {
  type DeadReason,
  isTerminalStatus,
  type JobStatus,
  type TransitionTarget,
} from '@pdp/contracts';

export interface JobState {
  status: JobStatus;
  /** Highest attempt that has started. */
  attempts: number;
  /** Scheduling attempt of the current generation; worker attempts are above it. */
  attemptBase: number;
  /**
   * Executions started in the current generation, the abandoned ones included; the
   * interrupted ones (handed back on shutdown) are not.
   */
  startedInGeneration: number;
}

export interface TransitionInput {
  to: TransitionTarget;
  attempt: number;
  interrupted?: boolean;
}

export interface RetryPolicy {
  /** Executions one generation may start before the job is dead as `exhausted`. */
  maxAttempts: number;
}

/** What the transition does to `job_executions` and the job row besides the status. */
export type TransitionEffect = 'schedule' | 'start' | 'retry' | 'interrupt' | 'succeed' | 'dead';

export type RejectCode = 'JOB_TERMINAL' | 'STALE_ATTEMPT' | 'INVALID_TRANSITION';

export type Decision =
  | {
      kind: 'apply';
      from: JobStatus;
      to: TransitionTarget;
      effect: TransitionEffect;
      deadReason?: DeadReason;
    }
  | { kind: 'noop'; reason: 'duplicate' | 'overtaken' }
  | { kind: 'reject'; code: RejectCode; message: string };

export type RedriveDecision = { kind: 'apply' } | { kind: 'reject'; message: string };

const reject = (code: RejectCode, message: string): Decision => ({ kind: 'reject', code, message });

/**
 * The single place that decides whether a status change is allowed.
 * Attempt `attemptBase` belongs to the scheduler; worker attempts are
 * `attemptBase + NATS delivery count`.
 *
 * A start or retry that would exceed `maxAttempts` turns into `dead` / `exhausted`
 * instead: the crash loop ends at the next delivery, the failing job at its last attempt.
 *
 * @param alreadyApplied the same (jobId, attempt, to) is already in job_transitions
 */
export function decide(
  job: JobState,
  req: TransitionInput,
  alreadyApplied: boolean,
  policy: RetryPolicy,
): Decision {
  if (alreadyApplied) return { kind: 'noop', reason: 'duplicate' };

  const { status, attempts, attemptBase, startedInGeneration } = job;
  const { to, attempt } = req;
  const apply = (effect: TransitionEffect): Decision => ({
    kind: 'apply',
    from: status,
    to,
    effect,
  });
  const dead = (deadReason: DeadReason): Decision => ({
    kind: 'apply',
    from: status,
    to: 'dead',
    effect: 'dead',
    deadReason,
  });
  const exhausted = startedInGeneration >= policy.maxAttempts;

  if (to === 'scheduled' && attempt === attemptBase) {
    // The scheduler may report after the worker has already started or finished the job.
    return status === 'queued' ? apply('schedule') : { kind: 'noop', reason: 'overtaken' };
  }

  if (isTerminalStatus(status)) {
    return reject('JOB_TERMINAL', `job is already ${status}`);
  }

  if (attempt < attemptBase) {
    return reject('STALE_ATTEMPT', `attempt ${attempt} belongs to an earlier generation`);
  }

  if (attempt === attemptBase) {
    return reject('INVALID_TRANSITION', `attempt ${attempt} is reserved for scheduling, got ${to}`);
  }

  switch (to) {
    case 'running':
      if (attempt <= attempts) {
        return reject('STALE_ATTEMPT', `attempt ${attempt} is not newer than ${attempts}`);
      }
      // Every earlier execution of this generation was abandoned or failed.
      if (exhausted) return dead('exhausted');
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
      // Not a failure: the next attempt gets the slot this one gives back.
      if (req.interrupted) return apply('interrupt');
      return exhausted ? dead('exhausted') : apply('retry');

    case 'succeeded':
      if (attempt > attempts)
        return reject('INVALID_TRANSITION', `attempt ${attempt} never started`);
      if (status === 'queued') return reject('INVALID_TRANSITION', 'job never started');
      // First success wins, even from an older attempt: results are written to deterministic keys.
      return apply('succeed');

    case 'dead':
      // A worker reports an error that no retry can fix.
      if (status !== 'running') return reject('INVALID_TRANSITION', `cannot fail a ${status} job`);
      if (attempt < attempts) return reject('STALE_ATTEMPT', `attempt ${attempt} < ${attempts}`);
      if (attempt > attempts)
        return reject('INVALID_TRANSITION', `attempt ${attempt} never started`);
      return dead('permanent');
  }
}

/**
 * Progress belongs to the attempt that is running now. An older attempt still working after
 * it was superseded, or one reporting after the job finished, is told to stop reporting.
 */
export function decideProgress(
  job: Pick<JobState, 'status' | 'attempts'>,
  attempt: number,
): { code: RejectCode; message: string } | null {
  if (isTerminalStatus(job.status)) {
    return { code: 'JOB_TERMINAL', message: `job is already ${job.status}` };
  }
  if (job.status !== 'running') {
    return { code: 'INVALID_TRANSITION', message: `cannot report progress of a ${job.status} job` };
  }
  if (attempt !== job.attempts) {
    return {
      code: 'STALE_ATTEMPT',
      message: `attempt ${attempt} is not the running ${job.attempts}`,
    };
  }
  return null;
}

/** Only a dead job is sent around again; anything else is still in flight or finished well. */
export function decideRedrive(job: Pick<JobState, 'status'>): RedriveDecision {
  return job.status === 'dead'
    ? { kind: 'apply' }
    : { kind: 'reject', message: `only a dead job can be redriven, this one is ${job.status}` };
}
