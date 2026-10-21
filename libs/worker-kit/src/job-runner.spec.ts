import { Logger } from '@nestjs/common';
import {
  type JobDispatchV1,
  type JobDto,
  type MetadataErrorCode,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { MetadataError } from '@pdp/metadata-client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type JobContext, type JobOutput, JobRunner, type JobRunnerDeps } from './job-runner';
import { PermanentError } from './permanent-error';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function dispatch(overrides: Partial<JobDispatchV1> = {}): JobDispatchV1 {
  return {
    version: 1,
    jobId: randomUUID(),
    type: 'image.resize',
    class: 'cpu',
    priority: 5,
    input: { sourceKey: 'uploads/u/a.png' },
    attemptBase: 0,
    dispatchedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Metadata applied the requested transition as asked. */
const asRequested = (_id: string, body: TransitionRequest) => withStatus(body.to);
const withStatus = (status: JobDto['status']) =>
  Promise.resolve({ applied: true, job: { status } } as TransitionResponse);
const conflict = (code: MetadataErrorCode) => new MetadataError(409, code, code);

const retry = { baseMs: 1000, maxMs: 60_000 };
const inputSchema = z.object({ sourceKey: z.string() });

function setup() {
  const deps = {
    transition: jest.fn<
      ReturnType<JobRunnerDeps['transition']>,
      Parameters<JobRunnerDeps['transition']>
    >(asRequested),
  };
  const process = jest.fn<Promise<JobOutput>, [JobContext, z.infer<typeof inputSchema>]>(() =>
    Promise.resolve({ done: true }),
  );
  const runner = new JobRunner(deps, {
    workerId: 'w1',
    retry,
    transitionRetry: { repeats: 2, delayMs: 1 },
  }).register({
    type: 'image.resize',
    inputSchema,
    process,
  });
  const run = (d: JobDispatchV1, deliveryCount = 1, signal?: AbortSignal) =>
    runner.handle({ data: encode(d), deliveryCount, consumer: 'worker-cpu' }, signal);
  const targets = () => deps.transition.mock.calls.map(([, body]) => `${body.to}@${body.attempt}`);
  const body = (call: number) => deps.transition.mock.calls[call]?.[1];
  return { deps, process, run, targets, body };
}

describe('JobRunner', () => {
  beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => jest.restoreAllMocks());

  it('runs the processor and reports its output before acking', async () => {
    const { process, run, targets, body } = setup();
    const job = dispatch();

    await expect(run(job, 2)).resolves.toEqual({ kind: 'ack' });

    expect(targets()).toEqual(['running@2', 'succeeded@2']);
    expect(process).toHaveBeenCalledWith(
      {
        jobId: job.jobId,
        attempt: 2,
        progress: expect.any(Function) as unknown,
        signal: expect.any(AbortSignal) as unknown,
      },
      { sourceKey: 'uploads/u/a.png' },
    );
    expect(body(1)).toMatchObject({ actor: 'worker:w1', output: { done: true } });
  });

  it('identifies the delivery for the inbox by consumer and dispatch id', async () => {
    const { run, body } = setup();
    const job = dispatch({ attemptBase: 4 });
    await run(job);
    const inbox = { consumer: 'worker-cpu', messageId: `dispatch:${job.jobId}:4` };
    expect(body(0)?.inbox).toEqual(inbox);
    expect(body(1)?.inbox).toEqual(inbox);
  });

  it('numbers attempts of a redriven job above its base', async () => {
    const { run, targets } = setup();
    await run(dispatch({ attemptBase: 4 }), 2);
    expect(targets()).toEqual(['running@6', 'succeeded@6']);
  });

  it('terminates malformed input without calling metadata', async () => {
    const { deps, run } = setup();
    const result = await run(dispatch({ input: { presets: [] } }));
    expect(result.kind).toBe('term');
    expect(deps.transition).not.toHaveBeenCalled();
  });

  it('terminates job types without a processor', async () => {
    const { deps, run } = setup();
    const result = await run(dispatch({ type: 'video.frames' }));
    expect(result).toEqual({ kind: 'term', reason: 'unexpected job type video.frames' });
    expect(deps.transition).not.toHaveBeenCalled();
  });

  it.each(['JOB_TERMINAL', 'STALE_ATTEMPT', 'DUPLICATE_DELIVERY'] as const)(
    'acks without processing when running is rejected with %s',
    async (code) => {
      const { deps, process, run } = setup();
      deps.transition.mockRejectedValueOnce(conflict(code));
      await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
      expect(process).not.toHaveBeenCalled();
    },
  );

  it('acks without processing when metadata ends a crash loop on start', async () => {
    const { deps, process, run } = setup();
    deps.transition.mockImplementationOnce(() => withStatus('dead'));
    await expect(run(dispatch(), 6)).resolves.toEqual({ kind: 'ack' });
    expect(process).not.toHaveBeenCalled();
  });

  it('terminates on INVALID_TRANSITION', async () => {
    const { deps, process, run } = setup();
    deps.transition.mockRejectedValueOnce(conflict('INVALID_TRANSITION'));
    expect((await run(dispatch())).kind).toBe('term');
    expect(process).not.toHaveBeenCalled();
  });

  it('naks with jittered backoff when metadata stays unavailable', async () => {
    const { deps, process, run, targets } = setup();
    deps.transition.mockRejectedValue(new MetadataError(0, undefined, 'timeout'));
    await expect(run(dispatch(), 2)).resolves.toEqual({ kind: 'nak', delayMs: 1000 });
    expect(targets()).toEqual(['running@2', 'running@2', 'running@2']);
    expect(process).not.toHaveBeenCalled();
  });

  // A nak would come back as the next attempt and use one up, though the start may have
  // been applied; Metadata takes the same (attempt, to) again as a no-op.
  it('repeats a start that timed out with the same attempt', async () => {
    const { deps, process, run, targets } = setup();
    deps.transition.mockRejectedValueOnce(new MetadataError(0, undefined, 'timeout'));
    await expect(run(dispatch(), 2)).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@2', 'running@2', 'succeeded@2']);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('repeats a success report that metadata failed to answer', async () => {
    const { deps, process, run, targets } = setup();
    deps.transition
      .mockImplementationOnce(asRequested)
      .mockRejectedValueOnce(new MetadataError(503, undefined, 'down'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'succeeded@1', 'succeeded@1']);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('repeats a retry report and still naks with the retry backoff', async () => {
    const { deps, process, run, targets } = setup();
    process.mockRejectedValueOnce(new Error('socket hang up'));
    deps.transition
      .mockImplementationOnce(asRequested)
      .mockRejectedValueOnce(new MetadataError(0, undefined, 'timeout'));
    await expect(run(dispatch(), 3)).resolves.toEqual({ kind: 'nak', delayMs: 2000 });
    expect(targets()).toEqual(['running@3', 'scheduled@3', 'scheduled@3']);
  });

  it('does not repeat a transition metadata rejected', async () => {
    const { deps, run, targets } = setup();
    deps.transition.mockRejectedValueOnce(conflict('INVALID_TRANSITION'));
    await expect(run(dispatch())).resolves.toMatchObject({ kind: 'term' });
    expect(targets()).toEqual(['running@1']);
  });

  it('continues after a duplicate running transition', async () => {
    const { deps, run, targets } = setup();
    deps.transition.mockResolvedValueOnce({
      applied: false,
      job: { status: 'running' },
    } as TransitionResponse);
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'succeeded@1']);
  });

  it('sends the job to dead and acks on permanent errors', async () => {
    const { process, run, targets, body } = setup();
    process.mockRejectedValueOnce(new PermanentError('unreadable image'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'dead@1']);
    expect(body(1)).toMatchObject({ error: 'unreadable image', inbox: { consumer: 'worker-cpu' } });
  });

  it('treats any error flagged permanent as permanent', async () => {
    const { process, run, targets } = setup();
    process.mockRejectedValueOnce(Object.assign(new Error('blocked'), { permanent: true }));
    await run(dispatch());
    expect(targets()).toEqual(['running@1', 'dead@1']);
  });

  it('schedules a retry and naks with jittered backoff on transient errors', async () => {
    const { process, run, targets } = setup();
    process.mockRejectedValueOnce(new Error('socket hang up'));
    // Third failure: ceiling 4000 ms, Math.random 0.5.
    await expect(run(dispatch(), 3)).resolves.toEqual({ kind: 'nak', delayMs: 2000 });
    expect(targets()).toEqual(['running@3', 'scheduled@3']);
  });

  it('waits as long as a transient error asks, within the retry ceiling', async () => {
    const { process, run } = setup();
    const busy = (retryAfterMs: number) => Object.assign(new Error('busy'), { retryAfterMs });
    process.mockRejectedValueOnce(busy(30_000)).mockRejectedValueOnce(busy(600_000));
    await expect(run(dispatch(), 1)).resolves.toEqual({ kind: 'nak', delayMs: 30_000 });
    await expect(run(dispatch(), 1)).resolves.toEqual({ kind: 'nak', delayMs: 60_000 });
  });

  it('acks when metadata turns the retry into dead / exhausted', async () => {
    const { deps, process, run, targets } = setup();
    process.mockRejectedValueOnce(new Error('503 slow down'));
    deps.transition
      .mockImplementationOnce(asRequested)
      .mockImplementationOnce(() => withStatus('dead'));
    await expect(run(dispatch(), 5)).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@5', 'scheduled@5']);
  });

  it('logs a job that ends in dead as an error once, with the reason', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const dead = (deadReason: JobDto['deadReason'], applied = true) =>
      Promise.resolve({ applied, job: { status: 'dead', deadReason } } as TransitionResponse);
    const { deps, process, run } = setup();
    const exhausted = dispatch();
    const unreadable = dispatch();
    process
      .mockRejectedValueOnce(new Error('timed out'))
      .mockRejectedValueOnce(new PermanentError('unreadable image'))
      .mockRejectedValueOnce(new PermanentError('unreadable image'))
      .mockRejectedValueOnce(new Error('socket hang up'));
    deps.transition
      .mockImplementationOnce(asRequested)
      .mockImplementationOnce(() => dead('exhausted'))
      .mockImplementationOnce(asRequested)
      .mockImplementationOnce(() => dead('permanent'))
      .mockImplementationOnce(asRequested)
      .mockImplementationOnce(() => dead('permanent', false));

    await run(exhausted, 5);
    await run(unreadable);
    await run(unreadable, 2);
    await run(dispatch(), 2);

    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenNthCalledWith(
      1,
      `job ${exhausted.jobId} is dead (exhausted) after attempt 5: timed out`,
    );
    expect(errors).toHaveBeenNthCalledWith(
      2,
      `job ${unreadable.jobId} is dead (permanent) after attempt 1: unreadable image`,
    );
  });

  it('hands an attempt cut short by shutdown back as interrupted and naks at once', async () => {
    const { process, run, targets, body } = setup();
    const shutdown = new AbortController();
    process.mockImplementationOnce(({ signal }) => {
      shutdown.abort(new Error('worker is shutting down'));
      return Promise.reject(signal.reason as Error);
    });
    await expect(run(dispatch(), 3, shutdown.signal)).resolves.toEqual({
      kind: 'nak',
      delayMs: 0,
    });
    expect(targets()).toEqual(['running@3', 'scheduled@3']);
    expect(body(1)).toMatchObject({
      interrupted: true,
      error: 'interrupted: worker shutting down',
    });
  });

  it('acks when the job was cancelled while being interrupted', async () => {
    const { deps, process, run } = setup();
    const shutdown = new AbortController();
    shutdown.abort();
    process.mockRejectedValueOnce(new Error('aborted'));
    deps.transition
      .mockImplementationOnce(asRequested)
      .mockRejectedValueOnce(conflict('JOB_TERMINAL'));
    await expect(run(dispatch(), 1, shutdown.signal)).resolves.toEqual({ kind: 'ack' });
  });

  it('reports success as usual when the job finished despite the abort', async () => {
    const { run, targets } = setup();
    const shutdown = new AbortController();
    shutdown.abort();
    await expect(run(dispatch(), 1, shutdown.signal)).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'succeeded@1']);
  });

  it('acks when another attempt already finished the job', async () => {
    const { deps, run } = setup();
    deps.transition.mockImplementationOnce(asRequested);
    deps.transition.mockRejectedValueOnce(conflict('JOB_TERMINAL'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
  });

  it('naks when metadata stays down while reporting success', async () => {
    const { deps, run } = setup();
    deps.transition.mockImplementationOnce(asRequested);
    deps.transition.mockRejectedValue(new MetadataError(503, undefined, 'down'));
    expect((await run(dispatch())).kind).toBe('nak');
  });

  it('reports progress for the attempt that is running', async () => {
    const progress = jest.fn(() => Promise.resolve());
    const runner = new JobRunner(
      { transition: asRequested, progress },
      { workerId: 'w1', retry },
    ).register({
      type: 'image.resize',
      inputSchema,
      process: (job) => {
        job.progress(42.7);
        return Promise.resolve({});
      },
    });
    const job = dispatch({ attemptBase: 3 });

    await runner.handle({ data: encode(job), deliveryCount: 2, consumer: 'worker-cpu' });

    expect(progress).toHaveBeenCalledWith(job.jobId, { attempt: 5, progress: 42 });
  });

  it('reports the step a job is in along with the percent', async () => {
    const progress = jest.fn(() => Promise.resolve());
    const runner = new JobRunner(
      { transition: asRequested, progress },
      { workerId: 'w1', retry },
    ).register({
      type: 'image.resize',
      inputSchema,
      process: (job) => {
        job.progress(10, 'separate');
        return Promise.resolve({});
      },
    });
    const job = dispatch({ attemptBase: 0 });

    await runner.handle({ data: encode(job), deliveryCount: 1, consumer: 'worker-cpu' });

    expect(progress).toHaveBeenCalledWith(job.jobId, {
      attempt: 1,
      progress: 10,
      step: 'separate',
    });
  });
});
