import { JobCreatedV1, type TransitionResponse } from '@pdp/contracts';
import { MetadataError } from '@pdp/metadata-client';
import { randomUUID } from 'node:crypto';
import { type JobCreatedDeps, JobCreatedHandler, RETRY_DELAY_MS } from './job-created.handler';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function jobCreated(priority = 5, attemptBase = 0) {
  const jobId = randomUUID();
  return {
    jobId,
    bytes: encode(
      JobCreatedV1.parse({
        eventId: randomUUID(),
        type: 'job.created',
        version: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          jobId,
          userId: randomUUID(),
          type: 'image.resize',
          priority,
          input: { sourceKey: 'uploads/u/a.png', presets: ['thumb'] },
          attemptBase,
        },
      }),
    ),
  };
}

function setup(transition: JobCreatedDeps['transition'] = jest.fn()) {
  const deps = {
    publish: jest.fn<Promise<{ duplicate: boolean }>, Parameters<JobCreatedDeps['publish']>>(() =>
      Promise.resolve({ duplicate: false }),
    ),
    transition: jest.fn(transition),
  };
  return { deps, handler: new JobCreatedHandler(deps) };
}

const ok = (): Promise<TransitionResponse> =>
  Promise.resolve({ applied: true } as TransitionResponse);

describe('JobCreatedHandler', () => {
  it('publishes the dispatch with a dedup id, then marks the job scheduled', async () => {
    const { deps, handler } = setup(ok);
    const { jobId, bytes } = jobCreated();

    await expect(handler.handle(bytes)).resolves.toEqual({ kind: 'ack' });

    expect(deps.publish).toHaveBeenCalledWith(
      'jobs.cpu.image.resize',
      expect.objectContaining({ jobId, class: 'cpu', version: 1 }),
      `dispatch:${jobId}:0`,
    );
    expect(deps.transition).toHaveBeenCalledWith(jobId, {
      to: 'scheduled',
      attempt: 0,
      actor: 'scheduler',
      class: 'cpu',
    });
    expect(deps.publish.mock.invocationCallOrder[0]).toBeLessThan(
      deps.transition.mock.invocationCallOrder[0]!,
    );
  });

  it('dispatches a redriven job under a new id and schedules its new generation', async () => {
    const { deps, handler } = setup(ok);
    const { jobId, bytes } = jobCreated(5, 4);

    await expect(handler.handle(bytes)).resolves.toEqual({ kind: 'ack' });

    expect(deps.publish).toHaveBeenCalledWith(
      'jobs.cpu.image.resize',
      expect.objectContaining({ jobId, attemptBase: 4 }),
      `dispatch:${jobId}:4`,
    );
    expect(deps.transition).toHaveBeenCalledWith(jobId, expect.objectContaining({ attempt: 4 }));
  });

  it('routes high priority jobs to the priority stream', async () => {
    const { deps, handler } = setup(ok);
    await handler.handle(jobCreated(9).bytes);
    expect(deps.publish.mock.calls[0]?.[0]).toBe('jobs.priority.image.resize');
  });

  it('terminates malformed events without side effects', async () => {
    const { deps, handler } = setup(ok);
    const result = await handler.handle(encode({ type: 'job.created', version: 2 }));
    expect(result.kind).toBe('term');
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('naks when publishing fails and does not touch metadata', async () => {
    const { deps, handler } = setup(ok);
    deps.publish.mockRejectedValueOnce(new Error('timeout'));
    await expect(handler.handle(jobCreated().bytes)).resolves.toEqual({
      kind: 'nak',
      delayMs: RETRY_DELAY_MS,
    });
    expect(deps.transition).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable', new MetadataError(0, undefined, 'timeout'), 'nak'],
    ['5xx', new MetadataError(503, undefined, 'down'), 'nak'],
    ['409 terminal', new MetadataError(409, 'JOB_TERMINAL', 'done'), 'ack'],
    ['404', new MetadataError(404, 'JOB_NOT_FOUND', 'gone'), 'term'],
    ['400', new MetadataError(400, 'VALIDATION_FAILED', 'bad'), 'term'],
  ])('maps metadata %s to %s', async (_name, error, kind) => {
    const { handler } = setup(() => Promise.reject(error));
    const result = await handler.handle(jobCreated().bytes);
    expect(result.kind).toBe(kind);
  });

  it('rethrows unexpected errors so the pull worker naks', async () => {
    const { handler } = setup(() => Promise.reject(new TypeError('bug')));
    await expect(handler.handle(jobCreated().bytes)).rejects.toThrow('bug');
  });
});
