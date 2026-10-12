import { type JetStreamManager } from '@nats-io/jetstream';
import { type BatchObservableCallback, type Histogram, metrics } from '@opentelemetry/api';
import { STREAMS, type StreamName } from '@pdp/contracts';

const meter = () => metrics.getMeter('@pdp/messaging');

/** `messaging.process.duration` of the semconv: one delivery through its handler. */
export function processDurationHistogram(): Histogram {
  return meter().createHistogram('messaging.process.duration', {
    description: 'One delivery through its handler, settled with ack, nak or term',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    },
  });
}

/**
 * Gauges for the depth of each stream and the backlog of each of its consumers, read
 * from JetStream on every metric export. Returns a function that stops observing.
 *
 * For a WorkQueue stream `nats.stream.messages` is the queue depth: waiting plus in
 * progress. EVENTS keeps messages for days, so its backlog is the consumers' `pending`.
 */
export function observeStreams(
  manager: () => Promise<JetStreamManager>,
  names = Object.keys(STREAMS) as StreamName[],
): () => void {
  const m = meter();
  const messages = m.createObservableGauge('nats.stream.messages', {
    description: 'Messages stored in the stream',
    unit: '{message}',
  });
  const pending = m.createObservableGauge('nats.consumer.pending', {
    description: 'Messages in the stream not yet delivered to the consumer',
    unit: '{message}',
  });
  const ackPending = m.createObservableGauge('nats.consumer.ack_pending', {
    description: 'Messages delivered to the consumer and not yet acked',
    unit: '{message}',
  });

  const observe: BatchObservableCallback = async (result) => {
    const jsm = await manager().catch(() => null);
    if (!jsm) return;
    for (const stream of names) {
      // A stream nobody has declared yet reports nothing rather than a misleading zero.
      const info = await jsm.streams.info(stream).catch(() => null);
      if (!info) continue;
      result.observe(messages, info.state.messages, { stream });
      for await (const consumer of jsm.consumers.list(stream)) {
        const attributes = { stream, consumer: consumer.name };
        result.observe(pending, consumer.num_pending, attributes);
        result.observe(ackPending, consumer.num_ack_pending, attributes);
      }
    }
  };
  const observables = [messages, pending, ackPending];
  m.addBatchObservableCallback(observe, observables);
  return () => m.removeBatchObservableCallback(observe, observables);
}
