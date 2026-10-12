import {
  AckPolicy,
  DeliverPolicy,
  JetStreamApiCodes,
  JetStreamApiError,
  type JetStreamManager,
  RetentionPolicy,
  type StreamConfig,
  StorageType,
} from '@nats-io/jetstream';
import { STREAMS, type StreamName } from '@pdp/contracts';

const ns = (ms: number): number => ms * 1_000_000;

const DUPLICATE_WINDOW_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_AGE_MS: Partial<Record<StreamName, number>> = {
  EVENTS: 7 * DAY_MS,
  JOBS_DLQ: 14 * DAY_MS,
};

function streamConfig(name: StreamName): Partial<StreamConfig> & { name: string } {
  const def = STREAMS[name];
  return {
    name: def.name,
    subjects: [...def.subjects],
    retention: def.retention === 'workqueue' ? RetentionPolicy.Workqueue : RetentionPolicy.Limits,
    storage: StorageType.File,
    duplicate_window: ns(DUPLICATE_WINDOW_MS),
    max_age: ns(MAX_AGE_MS[name] ?? 0),
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

/**
 * Messages stored in the stream. For a WorkQueue stream that is everything not yet
 * acked: waiting plus in progress. A stream nobody has declared yet is empty.
 */
export async function streamDepth(jsm: JetStreamManager, name: StreamName): Promise<number> {
  try {
    const info = await jsm.streams.info(name);
    return info.state.messages;
  } catch (err) {
    if (err instanceof JetStreamApiError && err.code === JetStreamApiCodes.StreamNotFound) return 0;
    throw err;
  }
}

export interface PullConsumerConfig {
  stream: StreamName;
  durable: string;
  filterSubject?: string;
  ackWaitMs: number;
  /** -1 for unlimited. */
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
