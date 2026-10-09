import { type JobStatus, type TransitionTarget } from '@pdp/contracts';
import { decide, type Decision } from './state-machine';

const job = (status: JobStatus, attempts = 0) => ({ status, attempts });
const req = (to: TransitionTarget, attempt: number) => ({ to, attempt });

const applied = (d: Decision) => (d.kind === 'apply' ? d.effect : undefined);
const rejected = (d: Decision) => (d.kind === 'reject' ? d.code : undefined);

describe('decide', () => {
  it('treats a repeated (jobId, attempt, to) as a duplicate no-op', () => {
    expect(decide(job('running', 1), req('running', 1), true)).toEqual({
      kind: 'noop',
      reason: 'duplicate',
    });
  });

  describe('scheduler (attempt 0)', () => {
    it('schedules a queued job', () => {
      expect(applied(decide(job('queued'), req('scheduled', 0), false))).toBe('schedule');
    });

    it.each<JobStatus>(['scheduled', 'running', 'succeeded', 'failed', 'dead'])(
      'is a no-op when the job is already %s',
      (status) => {
        expect(decide(job(status, 1), req('scheduled', 0), false)).toEqual({
          kind: 'noop',
          reason: 'overtaken',
        });
      },
    );

    it.each<TransitionTarget>(['running', 'succeeded', 'failed'])(
      'rejects attempt 0 for %s',
      (to) => {
        expect(rejected(decide(job('scheduled'), req(to, 0), false))).toBe('INVALID_TRANSITION');
      },
    );
  });

  describe('running', () => {
    it('starts the first attempt of a scheduled job', () => {
      expect(applied(decide(job('scheduled', 0), req('running', 1), false))).toBe('start');
    });

    it('starts a queued job when the worker overtakes the scheduler', () => {
      expect(applied(decide(job('queued', 0), req('running', 1), false))).toBe('start');
    });

    it('starts a newer attempt over an abandoned running one', () => {
      expect(applied(decide(job('running', 1), req('running', 2), false))).toBe('start');
    });

    it('starts the next attempt after a retry', () => {
      expect(applied(decide(job('scheduled', 1), req('running', 2), false))).toBe('start');
    });

    it('rejects an attempt that is not newer', () => {
      expect(rejected(decide(job('running', 2), req('running', 1), false))).toBe('STALE_ATTEMPT');
    });

    it.each<JobStatus>(['succeeded', 'failed', 'dead'])(
      'rejects a redelivery of a %s job so the worker skips processing',
      (status) => {
        expect(rejected(decide(job(status, 1), req('running', 2), false))).toBe('JOB_TERMINAL');
      },
    );
  });

  describe('retry (running -> scheduled)', () => {
    it('hands the current attempt back', () => {
      expect(applied(decide(job('running', 1), req('scheduled', 1), false))).toBe('retry');
    });

    it('rejects a retry from an older attempt', () => {
      expect(rejected(decide(job('running', 2), req('scheduled', 1), false))).toBe('STALE_ATTEMPT');
    });

    it('rejects a retry for an attempt that never started', () => {
      expect(rejected(decide(job('running', 1), req('scheduled', 2), false))).toBe(
        'INVALID_TRANSITION',
      );
    });

    it('rejects a retry when the job is not running', () => {
      expect(rejected(decide(job('scheduled', 1), req('scheduled', 1), false))).toBe(
        'INVALID_TRANSITION',
      );
    });
  });

  describe('succeeded', () => {
    it('finishes the current attempt', () => {
      expect(applied(decide(job('running', 1), req('succeeded', 1), false))).toBe('succeed');
    });

    it('accepts the first success from an older attempt', () => {
      expect(applied(decide(job('running', 2), req('succeeded', 1), false))).toBe('succeed');
    });

    it('accepts a success from an older attempt after a retry was scheduled', () => {
      expect(applied(decide(job('scheduled', 2), req('succeeded', 1), false))).toBe('succeed');
    });

    it('rejects a second success', () => {
      expect(rejected(decide(job('succeeded', 2), req('succeeded', 1), false))).toBe(
        'JOB_TERMINAL',
      );
    });

    it('rejects success for an attempt that never started', () => {
      expect(rejected(decide(job('running', 1), req('succeeded', 2), false))).toBe(
        'INVALID_TRANSITION',
      );
    });

    it('rejects success for a job that never started', () => {
      expect(rejected(decide(job('queued', 0), req('succeeded', 1), false))).toBe(
        'INVALID_TRANSITION',
      );
    });
  });

  describe('failed', () => {
    it('fails the current attempt', () => {
      expect(applied(decide(job('running', 3), req('failed', 3), false))).toBe('fail');
    });

    it('rejects a failure from an older attempt', () => {
      expect(rejected(decide(job('running', 3), req('failed', 2), false))).toBe('STALE_ATTEMPT');
    });

    it('rejects a failure for an attempt that never started', () => {
      expect(rejected(decide(job('running', 1), req('failed', 2), false))).toBe(
        'INVALID_TRANSITION',
      );
    });

    it('rejects failing a job that is not running', () => {
      expect(rejected(decide(job('scheduled', 1), req('failed', 1), false))).toBe(
        'INVALID_TRANSITION',
      );
    });

    it('rejects failing a finished job', () => {
      expect(rejected(decide(job('succeeded', 1), req('failed', 1), false))).toBe('JOB_TERMINAL');
    });
  });
});
