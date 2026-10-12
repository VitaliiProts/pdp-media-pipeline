import {
  type JobDto,
  type JobDispatchV1,
  type MetadataErrorCode,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { MetadataError } from '@pdp/metadata-client';
import { randomUUID } from 'node:crypto';
import { PermanentError } from '../image/permanent-error';
import { type ImageResizeDeps, ImageResizeHandler } from './image-resize.handler';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function dispatch(overrides: Partial<JobDispatchV1> = {}): JobDispatchV1 {
  return {
    version: 1,
    jobId: randomUUID(),
    type: 'image.resize',
    class: 'cpu',
    priority: 5,
    input: { sourceKey: 'uploads/u/a.png', presets: ['thumb', 'medium'] },
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

function setup() {
  const deps = {
    transition: jest.fn<
      ReturnType<ImageResizeDeps['transition']>,
      Parameters<ImageResizeDeps['transition']>
    >(asRequested),
    getObject: jest.fn<Promise<Buffer>, [string]>(() => Promise.resolve(Buffer.from('src'))),
    putObject: jest.fn<Promise<void>, [string, Buffer, string]>(() => Promise.resolve()),
    resize: jest.fn<ReturnType<ImageResizeDeps['resize']>, Parameters<ImageResizeDeps['resize']>>(
      (_input, presets) =>
        Promise.resolve(
          presets.map((preset) => ({ preset, width: 10, height: 5, data: Buffer.from(preset) })),
        ),
    ),
  };
  const handler = new ImageResizeHandler(deps, { workerId: 'w1', retry });
  const run = (d: JobDispatchV1, deliveryCount = 1) =>
    handler.handle({ data: encode(d), deliveryCount, consumer: 'worker-cpu' });
  const targets = () => deps.transition.mock.calls.map(([, body]) => `${body.to}@${body.attempt}`);
  const body = (call: number) => deps.transition.mock.calls[call]?.[1];
  return { deps, run, targets, body };
}

describe('ImageResizeHandler', () => {
  beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => jest.restoreAllMocks());

  it('runs, stores deterministic results and reports success before acking', async () => {
    const { deps, run, targets, body } = setup();
    const job = dispatch();

    await expect(run(job, 2)).resolves.toEqual({ kind: 'ack' });

    expect(targets()).toEqual(['running@2', 'succeeded@2']);
    expect(deps.putObject.mock.calls.map(([key]) => key)).toEqual([
      `results/${job.jobId}/thumb.webp`,
      `results/${job.jobId}/medium.webp`,
    ]);
    expect(body(1)).toMatchObject({
      actor: 'worker:w1',
      output: {
        results: [
          { preset: 'thumb', key: `results/${job.jobId}/thumb.webp`, bytes: 5 },
          { preset: 'medium', key: `results/${job.jobId}/medium.webp`, bytes: 6 },
        ],
      },
    });
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

  it('terminates malformed messages without calling metadata', async () => {
    const { deps, run } = setup();
    const result = await run(dispatch({ input: { presets: [] } }));
    expect(result.kind).toBe('term');
    expect(deps.transition).not.toHaveBeenCalled();
  });

  it.each(['JOB_TERMINAL', 'STALE_ATTEMPT', 'DUPLICATE_DELIVERY'] as const)(
    'acks without processing when running is rejected with %s',
    async (code) => {
      const { deps, run } = setup();
      deps.transition.mockRejectedValueOnce(conflict(code));
      await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
      expect(deps.getObject).not.toHaveBeenCalled();
    },
  );

  it('acks without processing when metadata ends a crash loop on start', async () => {
    const { deps, run } = setup();
    deps.transition.mockImplementationOnce(() => withStatus('dead'));
    await expect(run(dispatch(), 6)).resolves.toEqual({ kind: 'ack' });
    expect(deps.getObject).not.toHaveBeenCalled();
  });

  it('terminates on INVALID_TRANSITION', async () => {
    const { deps, run } = setup();
    deps.transition.mockRejectedValueOnce(conflict('INVALID_TRANSITION'));
    expect((await run(dispatch())).kind).toBe('term');
    expect(deps.getObject).not.toHaveBeenCalled();
  });

  it('naks with jittered backoff when metadata is unavailable', async () => {
    const { deps, run } = setup();
    deps.transition.mockRejectedValueOnce(new MetadataError(0, undefined, 'timeout'));
    await expect(run(dispatch(), 2)).resolves.toEqual({ kind: 'nak', delayMs: 1000 });
    expect(deps.getObject).not.toHaveBeenCalled();
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
    const { deps, run, targets, body } = setup();
    deps.resize.mockRejectedValueOnce(new PermanentError('unreadable image'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'dead@1']);
    expect(body(1)).toMatchObject({ error: 'unreadable image', inbox: { consumer: 'worker-cpu' } });
  });

  it('schedules a retry and naks with jittered backoff on transient errors', async () => {
    const { deps, run, targets } = setup();
    deps.getObject.mockRejectedValueOnce(new Error('socket hang up'));
    // Third failure: ceiling 4000 ms, Math.random 0.5.
    await expect(run(dispatch(), 3)).resolves.toEqual({ kind: 'nak', delayMs: 2000 });
    expect(targets()).toEqual(['running@3', 'scheduled@3']);
  });

  it('acks when metadata turns the retry into dead / exhausted', async () => {
    const { deps, run, targets } = setup();
    deps.putObject.mockRejectedValueOnce(new Error('503 slow down'));
    deps.transition
      .mockImplementationOnce(asRequested)
      .mockImplementationOnce(() => withStatus('dead'));
    await expect(run(dispatch(), 5)).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@5', 'scheduled@5']);
  });

  it('acks when another attempt already finished the job', async () => {
    const { deps, run } = setup();
    deps.transition.mockImplementationOnce(asRequested);
    deps.transition.mockRejectedValueOnce(conflict('JOB_TERMINAL'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
  });

  it('naks when metadata is down while reporting success', async () => {
    const { deps, run } = setup();
    deps.transition.mockImplementationOnce(asRequested);
    deps.transition.mockRejectedValueOnce(new MetadataError(503, undefined, 'down'));
    expect((await run(dispatch())).kind).toBe('nak');
  });
});
