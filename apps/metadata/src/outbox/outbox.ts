import { randomUUID } from 'node:crypto';
import { captureTraceContext } from '@pdp/observability';
import { type Tx } from '../database/postgres.service';
import { outbox } from '../database/schema';

interface EventDefinition<E> {
  type: string;
  version: number;
  subject: string;
  parse: (input: unknown) => E;
}

/**
 * Writes an event in the caller's transaction, so it is published if and only if
 * the state change commits. The relay picks it up afterwards, in the writer's trace.
 *
 * @param subject overrides the event's own subject, e.g. to route it to the DLQ stream
 */
export async function enqueueEvent<E, P>(
  tx: Tx,
  definition: EventDefinition<E>,
  payload: P,
  subject: string = definition.subject,
): Promise<E & { eventId: string }> {
  const eventId = randomUUID();
  const event = definition.parse({
    eventId,
    type: definition.type,
    version: definition.version,
    occurredAt: new Date().toISOString(),
    payload,
  });
  await tx
    .insert(outbox)
    .values({ id: eventId, subject, payload: event, traceContext: captureTraceContext() });
  return { ...event, eventId };
}
