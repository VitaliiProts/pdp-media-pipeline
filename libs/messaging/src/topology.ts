import {
  AckPolicy,
  DeliverPolicy,
  type JetStreamManager,
  RetentionPolicy,
  type StreamConfig,
  StorageType,
} from '@nats-io/jetstream';
import { STREAMS, type StreamName } from '@pdp/contracts';

const ns = (ms: number): number => ms * 1_000_000;

const DUPLICATE_WINDOW_MS = 2 * 60_000;
const EVENTS_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

function streamConfig(name: StreamName): Partial<StreamConfig> & { name: string } {
  const def = STREAMS[name];
  return {
    name: def.name,
    subjects: [...def.subjects],
    retention: def.retention === 'workqueue' ? RetentionPolicy.Workqueue : RetentionPolicy.Limits,
    storage: StorageType.File,
    duplicate_window: ns(DUPLICATE_WINDOW_MS),
    max_age: def.retention === 'limits' ? ns(EVENTS_MAX_AGE_MS) : 0,
  };
}

/** Idempotent: creates missing streams, updates existing ones to the declared config. */
export async function ensureStreams(jsm: JetStreamManager, names: StreamName[]): Promise<void> {
  for (const name of names) {
    const config = streamConfig(name);
    const exists = await jsm.streams.info(name).then(
      () => true,
      () => false,
    );
    if (exists) await jsm.streams.update(name, config);
    else await jsm.streams.add(config);
  }
}

export interface PullConsumerConfig {
  stream: StreamName;
  durable: string;
  filterSubject?: string;
  ackWaitMs: number;
  maxDeliver: number;
  maxAckPending: number;
}

export async function ensurePullConsumer(
  jsm: JetStreamManager,
  config: PullConsumerConfig,
): Promise<void> {
  const settings = {
    ack_wait: ns(config.ackWaitMs),
    max_deliver: config.maxDeliver,
    max_ack_pending: config.maxAckPending,
    filter_subject: config.filterSubject,
  };
  const exists = await jsm.consumers.info(config.stream, config.durable).then(
    () => true,
    () => false,
  );
  if (exists) {
    await jsm.consumers.update(config.stream, config.durable, settings);
  } else {
    await jsm.consumers.add(config.stream, {
      ...settings,
      durable_name: config.durable,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });
  }
}
