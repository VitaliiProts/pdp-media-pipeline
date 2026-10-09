import { type JobDispatchV1, type TransitionResponse } from '@pdp/contracts';
import { MetadataError } from '@pdp/metadata-client';
import { randomUUID } from 'node:crypto';
import { PermanentError } from '../image/permanent-error';
import {
  type ImageResizeDeps,
  ImageResizeHandler,
  RETRY_BASE_DELAY_MS,
} from './image-resize.handler';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function dispatch(overrides: Partial<JobDispatchV1> = {}): JobDispatchV1 {
  return {
    version: 1,
    jobId: randomUUID(),
    type: 'image.resize',
    class: 'cpu',
    priority: 5,
    input: { sourceKey: 'uploads/u/a.png', presets: ['thumb', 'medium'] },
    dispatchedAt: new Date().toISOString(),
    ...overrides,
  };
}

const applied = () => Promise.resolve({ applied: true } as TransitionResponse);
const conflict = (code: 'JOB_TERMINAL' | 'STALE_ATTEMPT' | 'INVALID_TRANSITION') =>
  new MetadataError(409, code, code);

function setup() {
  const deps = {
    transition: jest.fn<
      ReturnType<ImageResizeDeps['transition']>,
      Parameters<ImageResizeDeps['transition']>
    >(applied),
    getObject: jest.fn<Promise<Buffer>, [string]>(() => Promise.resolve(Buffer.from('src'))),
    putObject: jest.fn<Promise<void>, [string, Buffer, string]>(() => Promise.resolve()),
    resize: jest.fn<ReturnType<ImageResizeDeps['resize']>, Parameters<ImageResizeDeps['resize']>>(
      (_input, presets) =>
        Promise.resolve(
          presets.map((preset) => ({ preset, width: 10, height: 5, data: Buffer.from(preset) })),
        ),
    ),
  };
  const handler = new ImageResizeHandler(deps, { workerId: 'w1', maxDeliver: 3 });
  const run = (d: JobDispatchV1, deliveryCount = 1) =>
    handler.handle({ data: encode(d), deliveryCount });
  const targets = () => deps.transition.mock.calls.map(([, body]) => `${body.to}@${body.attempt}`);
  return { deps, run, targets };
}

describe('ImageResizeHandler', () => {
  it('runs, stores deterministic results and reports success before acking', async () => {
    const { deps, run, targets } = setup();
    const job = dispatch();

    await expect(run(job, 2)).resolves.toEqual({ kind: 'ack' });

    expect(targets()).toEqual(['running@2', 'succeeded@2']);
    expect(deps.putObject.mock.calls.map(([key]) => key)).toEqual([
      `results/${job.jobId}/thumb.webp`,
      `results/${job.jobId}/medium.webp`,
    ]);
    expect(deps.transition.mock.calls[1]?.[1]).toMatchObject({
      actor: 'worker:w1',
      output: {
        results: [
          { preset: 'thumb', key: `results/${job.jobId}/thumb.webp`, bytes: 5 },
          { preset: 'medium', key: `results/${job.jobId}/medium.webp`, bytes: 6 },
        ],
      },
    });
  });

  it('terminates malformed messages without calling metadata', async () => {
    const { deps, run } = setup();
    const result = await run(dispatch({ input: { presets: [] } }));
    expect(result.kind).toBe('term');
    expect(deps.transition).not.toHaveBeenCalled();
  });

  it.each(['JOB_TERMINAL', 'STALE_ATTEMPT'] as const)(
    'acks without processing when running is rejected with %s',
    async (code) => {
      const { deps, run } = setup();
      deps.transition.mockRejectedValueOnce(conflict(code));
      await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
      expect(deps.getObject).not.toHaveBeenCalled();
    },
  );

  it('terminates on INVALID_TRANSITION', async () => {
    const { deps, run } = setup();
    deps.transition.mockRejectedValueOnce(conflict('INVALID_TRANSITION'));
    expect((await run(dispatch())).kind).toBe('term');
    expect(deps.getObject).not.toHaveBeenCalled();
  });

  it('naks with backoff when metadata is unavailable', async () => {
    const { deps, run } = setup();
    deps.transition.mockRejectedValueOnce(new MetadataError(0, undefined, 'timeout'));
    await expect(run(dispatch(), 2)).resolves.toEqual({
      kind: 'nak',
      delayMs: RETRY_BASE_DELAY_MS * 2,
    });
    expect(deps.getObject).not.toHaveBeenCalled();
  });

  it('continues after a duplicate running transition', async () => {
    const { deps, run, targets } = setup();
    deps.transition.mockResolvedValueOnce({ applied: false } as TransitionResponse);
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'succeeded@1']);
  });

  it('fails the job and acks on permanent errors', async () => {
    const { deps, run, targets } = setup();
    deps.resize.mockRejectedValueOnce(new PermanentError('unreadable image'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@1', 'failed@1']);
    expect(deps.transition.mock.calls[1]?.[1].error).toBe('unreadable image');
  });

  it('schedules a retry and naks on transient errors before the last attempt', async () => {
    const { deps, run, targets } = setup();
    deps.getObject.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(run(dispatch(), 2)).resolves.toEqual({
      kind: 'nak',
      delayMs: RETRY_BASE_DELAY_MS * 2,
    });
    expect(targets()).toEqual(['running@2', 'scheduled@2']);
  });

  it('fails the job on the last attempt', async () => {
    const { deps, run, targets } = setup();
    deps.putObject.mockRejectedValueOnce(new Error('503 slow down'));
    await expect(run(dispatch(), 3)).resolves.toEqual({ kind: 'ack' });
    expect(targets()).toEqual(['running@3', 'failed@3']);
  });

  it('acks when another attempt already finished the job', async () => {
    const { deps, run } = setup();
    deps.transition.mockResolvedValueOnce({ applied: true } as TransitionResponse);
    deps.transition.mockRejectedValueOnce(conflict('JOB_TERMINAL'));
    await expect(run(dispatch())).resolves.toEqual({ kind: 'ack' });
  });

  it('naks when metadata is down while reporting success', async () => {
    const { deps, run } = setup();
    deps.transition.mockResolvedValueOnce({ applied: true } as TransitionResponse);
    deps.transition.mockRejectedValueOnce(new MetadataError(503, undefined, 'down'));
    expect((await run(dispatch())).kind).toBe('nak');
  });
});
