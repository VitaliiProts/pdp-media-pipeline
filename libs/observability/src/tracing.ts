import {
  type Attributes,
  context,
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

/** Baggage entries with this prefix become span attributes in every service. */
export const JOB_BAGGAGE_PREFIX = 'job.';

const tracer = trace.getTracer('@pdp/observability');

export interface TracedOptions {
  attributes?: Attributes;
  kind?: SpanKind;
}

/**
 * Runs `fn` in a new active span. A throw marks the span as failed and is rethrown;
 * without a started SDK this is a cheap no-op.
 */
export function traced<T>(
  name: string,
  options: TracedOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    async (span) => {
      try {
        return await fn(span);
      } catch (err) {
        markFailed(span, err);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function markFailed(span: Span, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

export interface JobTraceContext {
  id: string;
  type?: string;
  class?: string | null;
}

/**
 * Puts the job into baggage, so every span and log line downstream carries it, also
 * in other services: baggage travels with the trace context over HTTP and NATS.
 * Replaces the entries of an enclosing job, e.g. when a finished job creates deliveries.
 */
export function withJobContext<T>(job: JobTraceContext, fn: () => T): T {
  let baggage = propagation.getActiveBaggage() ?? propagation.createBaggage();
  for (const [key] of baggage.getAllEntries()) {
    if (key.startsWith(JOB_BAGGAGE_PREFIX)) baggage = baggage.removeEntry(key);
  }
  const attributes: Attributes = {};
  for (const key of ['id', 'type', 'class'] as const) {
    const value = job[key];
    if (typeof value !== 'string') continue;
    baggage = baggage.setEntry(`${JOB_BAGGAGE_PREFIX}${key}`, { value });
    attributes[`${JOB_BAGGAGE_PREFIX}${key}`] = value;
  }
  // The baggage processor only sees spans started from now on.
  trace.getActiveSpan()?.setAttributes(attributes);
  return context.with(propagation.setBaggage(context.active(), baggage), fn);
}

/** `job_id` and `job_type` for log lines written while a job is in context. */
export function jobLogFields(): Record<string, string> {
  const baggage = propagation.getActiveBaggage();
  if (!baggage) return {};
  const fields: Record<string, string> = {};
  for (const [key, entry] of baggage.getAllEntries()) {
    if (key.startsWith(JOB_BAGGAGE_PREFIX)) {
      fields[`job_${key.slice(JOB_BAGGAGE_PREFIX.length)}`] = entry.value;
    }
  }
  return fields;
}

/** The trace the current code runs in, or `null` when tracing is off. */
export function currentTraceId(): string | null {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : null;
}

export type TraceCarrier = Record<string, string>;

/** Serialises the active context (trace and baggage) to store it, e.g. in the outbox. */
export function captureTraceContext(): TraceCarrier | null {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length > 0 ? carrier : null;
}

/** Runs `fn` as a continuation of a stored context, or as a new trace without one. */
export function withStoredTraceContext<T>(carrier: TraceCarrier | null, fn: () => T): T {
  const parent = carrier ? propagation.extract(ROOT_CONTEXT, carrier) : ROOT_CONTEXT;
  return context.with(parent, fn);
}
