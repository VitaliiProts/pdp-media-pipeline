import { propagation, SpanStatusCode } from '@opentelemetry/api';
import { startTestTracing, type TestTracing } from './testing';
import {
  captureTraceContext,
  currentTraceId,
  jobLogFields,
  traced,
  withJobContext,
  withStoredTraceContext,
} from './tracing';

describe('tracing helpers', () => {
  let tracing: TestTracing;

  beforeAll(() => {
    tracing = startTestTracing();
  });
  afterEach(() => tracing.reset());
  afterAll(() => tracing.stop());

  it('marks a span failed when the function throws', async () => {
    await expect(traced('boom', {}, () => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope',
    );

    const [span] = tracing.spans();
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'nope' });
    expect(span?.events.map((e) => e.name)).toEqual(['exception']);
  });

  it('puts the job into baggage, span attributes and log fields', async () => {
    await traced('outer', {}, async () => {
      await withJobContext({ id: 'job-1', type: 'image.resize' }, async () => {
        expect(jobLogFields()).toEqual({ job_id: 'job-1', job_type: 'image.resize' });
        await traced('inner', {}, () => Promise.resolve());
      });
    });

    const byName = new Map(tracing.spans().map((s) => [s.name, s]));
    // The active span gets the attributes directly, spans started later through baggage.
    expect(byName.get('outer')?.attributes).toMatchObject({ 'job.id': 'job-1' });
    expect(byName.get('inner')?.attributes).toMatchObject({
      'job.id': 'job-1',
      'job.type': 'image.resize',
    });
  });

  it('replaces the enclosing job instead of merging into it', async () => {
    await withJobContext({ id: 'parent', type: 'image.resize', class: 'cpu' }, () =>
      withJobContext({ id: 'delivery', type: 'webhook.deliver' }, () => {
        expect(jobLogFields()).toEqual({ job_id: 'delivery', job_type: 'webhook.deliver' });
        return Promise.resolve();
      }),
    );
  });

  it('has no log fields outside a job', () => {
    expect(jobLogFields()).toEqual({});
  });

  it('continues a stored context as the same trace, with its baggage', async () => {
    let stored: ReturnType<typeof captureTraceContext> = null;
    let traceId: string | null = null;
    await traced('request', {}, () => {
      traceId = currentTraceId();
      withJobContext({ id: 'job-2' }, () => {
        stored = captureTraceContext();
      });
      return Promise.resolve();
    });
    expect(stored).toHaveProperty('traceparent');

    await withStoredTraceContext(stored, () =>
      traced('relay publish', {}, () => {
        expect(currentTraceId()).toBe(traceId);
        expect(propagation.getActiveBaggage()?.getEntry('job.id')?.value).toBe('job-2');
        return Promise.resolve();
      }),
    );
    const relay = tracing.spans().find((s) => s.name === 'relay publish');
    expect(relay?.attributes).toMatchObject({ 'job.id': 'job-2' });
  });

  it('starts a new trace when nothing was stored', async () => {
    expect(captureTraceContext()).toBeNull();
    const ids = await withStoredTraceContext(null, () =>
      traced('fresh', {}, () => Promise.resolve(currentTraceId())),
    );
    expect(ids).toMatch(/^[0-9a-f]{32}$/);
  });
});
