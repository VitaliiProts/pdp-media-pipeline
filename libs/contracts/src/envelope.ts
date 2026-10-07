import { z } from 'zod';

/**
 * Every event on the bus is wrapped in the same envelope.
 * `eventId` doubles as `Nats-Msg-Id` for JetStream deduplication.
 * Breaking payload changes require a new `version`; consumers must reject unknown versions.
 */
export function defineEvent<
  const Type extends string,
  const Version extends number,
  Payload extends z.ZodObject,
>(type: Type, version: Version, payload: Payload) {
  const schema = z.object({
    eventId: z.uuid(),
    type: z.literal(type),
    version: z.literal(version),
    occurredAt: z.iso.datetime(),
    traceparent: z.string().optional(),
    payload,
  });

  return {
    type,
    version,
    subject: `events.${type}.v${version}`,
    schema,
    parse: (input: unknown) => schema.parse(input),
  } as const;
}

export type EventOf<D extends { schema: z.ZodType }> = z.infer<D['schema']>;
