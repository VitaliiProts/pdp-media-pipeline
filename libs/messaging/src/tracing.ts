import {
  type Attributes,
  context,
  type Context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TextMapGetter,
  type TextMapSetter,
  trace,
} from '@opentelemetry/api';
import { type MsgHdrs } from '@nats-io/transport-node';

const tracer = trace.getTracer('@pdp/messaging');

const setter: TextMapSetter<MsgHdrs> = {
  set: (headers, key, value) => headers.set(key, value),
};

const getter: TextMapGetter<MsgHdrs | undefined> = {
  keys: (headers) => headers?.keys() ?? [],
  get: (headers, key) => (headers?.has(key) ? headers.get(key) : undefined),
};

/** Writes `traceparent`, `tracestate` and `baggage` of the active context into NATS headers. */
export function injectTraceHeaders(headers: MsgHdrs): void {
  propagation.inject(context.active(), headers, setter);
}

export function extractTraceContext(headers: MsgHdrs | undefined): Context {
  return propagation.extract(context.active(), headers, getter);
}

function messagingAttributes(subject: string, operation: 'send' | 'process'): Attributes {
  return {
    'messaging.system': 'nats',
    'messaging.destination.name': subject,
    'messaging.operation.type': operation,
    'messaging.operation.name': operation,
  };
}

export function withProducerSpan<T>(
  subject: string,
  msgId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `send ${subject}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: { ...messagingAttributes(subject, 'send'), 'messaging.message.id': msgId },
    },
    async (span) => {
      try {
        return await fn(span);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export interface ConsumedMessage {
  subject: string;
  headers?: MsgHdrs;
  seq: number;
  info: { deliveryCount: number };
}

/** Continues the publisher's trace: the consumer span is a child of the producer span. */
export function withConsumerSpan<T>(
  msg: ConsumedMessage,
  consumerName: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = extractTraceContext(msg.headers);
  const attributes: Attributes = {
    ...messagingAttributes(msg.subject, 'process'),
    'messaging.consumer.group.name': consumerName,
    'messaging.nats.stream_sequence': msg.seq,
    'messaging.nats.delivery_count': msg.info.deliveryCount,
  };
  const msgId = msg.headers?.has('Nats-Msg-Id') ? msg.headers.get('Nats-Msg-Id') : undefined;
  if (msgId) attributes['messaging.message.id'] = msgId;
  return context.with(parent, () =>
    tracer.startActiveSpan(
      `process ${msg.subject}`,
      { kind: SpanKind.CONSUMER, attributes },
      async (span) => {
        try {
          return await fn(span);
        } finally {
          span.end();
        }
      },
    ),
  );
}
