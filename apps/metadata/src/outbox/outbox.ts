import { randomUUID } from 'node:crypto';
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
 * the state change commits. The relay picks it up afterwards.
 */
export async function enqueueEvent<E, P>(
  tx: Tx,
  definition: EventDefinition<E>,
  payload: P,
): Promise<E & { eventId: string }> {
  const eventId = randomUUID();
  const event = definition.parse({
    eventId,
    type: definition.type,
    version: definition.version,
    occurredAt: new Date().toISOString(),
    payload,
  });
  await tx.insert(outbox).values({ id: eventId, subject: definition.subject, payload: event });
  return { ...event, eventId };
}
