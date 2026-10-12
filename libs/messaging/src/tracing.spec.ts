import { headers } from '@nats-io/transport-node';
import { SpanKind } from '@opentelemetry/api';
import { startTestTracing, type TestTracing } from '@pdp/observability/testing';
import { withJobContext } from '@pdp/observability';
import { injectTraceHeaders, withConsumerSpan, withProducerSpan } from './tracing';

describe('trace context over NATS headers', () => {
  let tracing: TestTracing;

  beforeAll(() => {
    tracing = startTestTracing();
  });
  afterEach(() => tracing.reset());
  afterAll(() => tracing.stop());

  it('makes the consumer span a child of the producer span, with the job baggage', async () => {
    const hdrs = headers();
    await withJobContext({ id: 'job-7', type: 'image.resize' }, () =>
      withProducerSpan('jobs.image.resize', 'msg-1', () =>
        Promise.resolve(injectTraceHeaders(hdrs)),
      ),
    );
    expect(hdrs.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(hdrs.get('baggage')).toContain('job.id=job-7');

    hdrs.set('Nats-Msg-Id', 'msg-1');
    await withConsumerSpan(
      { subject: 'jobs.image.resize', headers: hdrs, seq: 3, info: { deliveryCount: 2 } },
      'image-resize',
      () => Promise.resolve(),
    );

    const producer = tracing.spans().find((s) => s.kind === SpanKind.PRODUCER);
    const consumer = tracing.spans().find((s) => s.kind === SpanKind.CONSUMER);
    expect(consumer?.spanContext().traceId).toBe(producer?.spanContext().traceId);
    expect(consumer?.parentSpanContext?.spanId).toBe(producer?.spanContext().spanId);
    expect(consumer?.name).toBe('process jobs.image.resize');
    expect(consumer?.attributes).toMatchObject({
      'job.id': 'job-7',
      'messaging.message.id': 'msg-1',
      'messaging.nats.delivery_count': 2,
    });
  });

  it('starts a new trace for a message without headers', async () => {
    await withConsumerSpan(
      { subject: 'jobs.created', seq: 1, info: { deliveryCount: 1 } },
      'scheduler',
      () => Promise.resolve(),
    );
    const [span] = tracing.spans();
    expect(span?.parentSpanContext).toBeUndefined();
  });
});
