import { type JobStatus, type TransitionTarget } from '@pdp/contracts';
import {
  decide,
  decideProgress,
  decideRedrive,
  type Decision,
  type JobState,
} from './state-machine';

const policy = { maxAttempts: 3 };

const job = (status: JobStatus, attempts = 0, rest: Partial<JobState> = {}): JobState => ({
  status,
  attempts,
  attemptBase: 0,
  startedInGeneration: attempts,
  ...rest,
});
const req = (to: TransitionTarget, attempt: number) => ({ to, attempt });
const run = (state: JobState, to: TransitionTarget, attempt: number) =>
  decide(state, req(to, attempt), false, policy);

const applied = (d: Decision) => (d.kind === 'apply' ? d.effect : undefined);
const rejected = (d: Decision) => (d.kind === 'reject' ? d.code : undefined);

describe('decide', () => {
  it('treats a repeated (jobId, attempt, to) as a duplicate no-op', () => {
    expect(decide(job('running', 1), req('running', 1), true, policy)).toEqual({
      kind: 'noop',
      reason: 'duplicate',
    });
  });

  describe('scheduler (attempt = attemptBase)', () => {
    it('schedules a queued job', () => {
      expect(applied(run(job('queued'), 'scheduled', 0))).toBe('schedule');
    });

    it('schedules a redriven job at its new base', () => {
      const redriven = job('queued', 3, { attemptBase: 4, startedInGeneration: 0 });
      expect(applied(run(redriven, 'scheduled', 4))).toBe('schedule');
    });

    it.each<JobStatus>(['scheduled', 'running', 'succeeded', 'failed', 'dead'])(
      'is a no-op when the job is already %s',
      (status) => {
        expect(run(job(status, 1), 'scheduled', 0)).toEqual({ kind: 'noop', reason: 'overtaken' });
      },
    );

    it.each<TransitionTarget>(['running', 'succeeded', 'dead'])(
      'rejects the scheduling attempt for %s',
      (to) => {
        expect(rejected(run(job('scheduled'), to, 0))).toBe('INVALID_TRANSITION');
      },
    );

    it('rejects a late scheduler report from an earlier generation', () => {
      const redriven = job('scheduled', 3, { attemptBase: 4, startedInGeneration: 0 });
      expect(rejected(run(redriven, 'scheduled', 0))).toBe('STALE_ATTEMPT');
    });
  });

  describe('running', () => {
    it('starts the first attempt of a scheduled job', () => {
      expect(applied(run(job('scheduled', 0), 'running', 1))).toBe('start');
    });

    it('starts a queued job when the worker overtakes the scheduler', () => {
      expect(applied(run(job('queued', 0), 'running', 1))).toBe('start');
    });

    it('starts a newer attempt over an abandoned running one', () => {
      expect(applied(run(job('running', 1), 'running', 2))).toBe('start');
    });

    it('starts the next attempt after a retry', () => {
      expect(applied(run(job('scheduled', 1), 'running', 2))).toBe('start');
    });

    it('rejects an attempt that is not newer', () => {
      expect(rejected(run(job('running', 2), 'running', 1))).toBe('STALE_ATTEMPT');
    });

    it('ends a crash loop once every allowed attempt was started', () => {
      expect(run(job('running', 3), 'running', 4)).toMatchObject({
        kind: 'apply',
        to: 'dead',
        effect: 'dead',
        deadReason: 'exhausted',
      });
    });

    it('counts only executions of the current generation', () => {
      const redriven = job('scheduled', 3, { attemptBase: 4, startedInGeneration: 0 });
      expect(applied(run(redriven, 'running', 5))).toBe('start');
    });

    it('rejects an attempt from an earlier generation', () => {
      const redriven = job('running', 5, { attemptBase: 4, startedInGeneration: 1 });
      expect(rejected(run(redriven, 'running', 3))).toBe('STALE_ATTEMPT');
    });

    it.each<JobStatus>(['succeeded', 'failed', 'dead'])(
      'rejects a redelivery of a %s job so the worker skips processing',
      (status) => {
        expect(rejected(run(job(status, 1), 'running', 2))).toBe('JOB_TERMINAL');
      },
    );
  });

  describe('retry (running -> scheduled)', () => {
    it('hands the current attempt back', () => {
      expect(applied(run(job('running', 1), 'scheduled', 1))).toBe('retry');
    });

    it('turns the retry of the last allowed attempt into dead / exhausted', () => {
      expect(run(job('running', 3), 'scheduled', 3)).toMatchObject({
        to: 'dead',
        deadReason: 'exhausted',
      });
    });

    it('rejects a retry from an older attempt', () => {
      expect(rejected(run(job('running', 2), 'scheduled', 1))).toBe('STALE_ATTEMPT');
    });

    it('rejects a retry for an attempt that never started', () => {
      expect(rejected(run(job('running', 1), 'scheduled', 2))).toBe('INVALID_TRANSITION');
    });

    it('rejects a retry when the job is not running', () => {
      expect(rejected(run(job('scheduled', 1), 'scheduled', 1))).toBe('INVALID_TRANSITION');
    });
  });

  describe('succeeded', () => {
    it('finishes the current attempt', () => {
      expect(applied(run(job('running', 1), 'succeeded', 1))).toBe('succeed');
    });

    it('accepts the first success from an older attempt', () => {
      expect(applied(run(job('running', 2), 'succeeded', 1))).toBe('succeed');
    });

    it('accepts a success from an older attempt after a retry was scheduled', () => {
      expect(applied(run(job('scheduled', 2), 'succeeded', 1))).toBe('succeed');
    });

    it('accepts the last allowed attempt', () => {
      expect(applied(run(job('running', 3), 'succeeded', 3))).toBe('succeed');
    });

    it('rejects a second success', () => {
      expect(rejected(run(job('succeeded', 2), 'succeeded', 1))).toBe('JOB_TERMINAL');
    });

    it('rejects success for an attempt that never started', () => {
      expect(rejected(run(job('running', 1), 'succeeded', 2))).toBe('INVALID_TRANSITION');
    });

    it('rejects success for a job that never started', () => {
      expect(rejected(run(job('queued', 0), 'succeeded', 1))).toBe('INVALID_TRANSITION');
    });
  });

  describe('dead (permanent error)', () => {
    it('ends the current attempt as permanent', () => {
      expect(run(job('running', 1), 'dead', 1)).toMatchObject({
        to: 'dead',
        effect: 'dead',
        deadReason: 'permanent',
      });
    });

    it('rejects a report from an older attempt', () => {
      expect(rejected(run(job('running', 3), 'dead', 2))).toBe('STALE_ATTEMPT');
    });

    it('rejects a report for an attempt that never started', () => {
      expect(rejected(run(job('running', 1), 'dead', 2))).toBe('INVALID_TRANSITION');
    });

    it('rejects a job that is not running', () => {
      expect(rejected(run(job('scheduled', 1), 'dead', 1))).toBe('INVALID_TRANSITION');
    });

    it('rejects a finished job', () => {
      expect(rejected(run(job('succeeded', 1), 'dead', 1))).toBe('JOB_TERMINAL');
    });
  });
});

describe('decideProgress', () => {
  it('accepts the running attempt', () => {
    expect(decideProgress({ status: 'running', attempts: 2 }, 2)).toBeNull();
  });

  it('rejects an attempt that was superseded by a newer one', () => {
    expect(decideProgress({ status: 'running', attempts: 3 }, 2)?.code).toBe('STALE_ATTEMPT');
  });

  it.each<JobStatus>(['queued', 'scheduled'])('rejects a %s job', (status) => {
    expect(decideProgress({ status, attempts: 1 }, 1)?.code).toBe('INVALID_TRANSITION');
  });

  it.each<JobStatus>(['succeeded', 'dead'])('rejects a %s job', (status) => {
    expect(decideProgress({ status, attempts: 1 }, 1)?.code).toBe('JOB_TERMINAL');
  });
});

describe('decideRedrive', () => {
  it('redrives a dead job', () => {
    expect(decideRedrive({ status: 'dead' })).toEqual({ kind: 'apply' });
  });

  it.each<JobStatus>(['queued', 'scheduled', 'running', 'succeeded', 'failed'])(
    'refuses a %s job',
    (status) => {
      expect(decideRedrive({ status }).kind).toBe('reject');
    },
  );
});
