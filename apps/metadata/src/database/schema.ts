import {
  DEAD_REASONS,
  JOB_CLASSES,
  JOB_STATUSES,
  JOB_TYPES,
  type JobDto,
  WEBHOOK_EVENTS,
} from '@pdp/contracts';
import { type TraceCarrier } from '@pdp/observability';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Millisecond precision: keyset cursors round-trip through JS Date without losing rows.
const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const jobStatus = pgEnum('job_status', JOB_STATUSES);
export const jobClass = pgEnum('job_class', JOB_CLASSES);
export const jobType = pgEnum('job_type', JOB_TYPES);
export const deadReason = pgEnum('dead_reason', DEAD_REASONS);
export const webhookEvent = pgEnum('webhook_event', WEBHOOK_EVENTS);
export const executionOutcome = pgEnum('execution_outcome', [
  'succeeded',
  'retry',
  'failed',
  'abandoned',
  'interrupted',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: jobType('type').notNull(),
    class: jobClass('class'),
    status: jobStatus('status').notNull().default('queued'),
    priority: smallint('priority').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    attempts: integer('attempts').notNull().default(0),
    /** Set to `attempts + 1` by a redrive; attempts at or below it belong to earlier generations. */
    attemptBase: integer('attempt_base').notNull().default(0),
    deadReason: deadReason('dead_reason'),
    lastError: text('last_error'),
    /** Trace of the request that created or last redrove the job. */
    traceId: text('trace_id'),
    /** Percent of the current attempt; not a status change, so `updated_at` stays. */
    progress: smallint('progress'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('jobs_user_created_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('jobs_user_status_created_idx').on(t.userId, t.status, t.createdAt.desc(), t.id.desc()),
    // Partial: stays small as finished jobs pile up; used to find stuck jobs.
    index('jobs_active_status_idx')
      .on(t.status)
      .where(sql`${t.status} in ('queued', 'scheduled', 'running')`),
    // Delivery history of one webhook endpoint. The predicate avoids the `webhook.deliver`
    // enum value, which cannot be used in the transaction that adds it.
    index('jobs_webhook_endpoint_idx')
      .on(sql`(${t.input}->>'endpointId')`, t.createdAt.desc(), t.id.desc())
      .where(sql`(${t.input}->>'endpointId') is not null`),
  ],
);

export const jobExecutions = pgTable(
  'job_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    attempt: integer('attempt').notNull(),
    workerId: text('worker_id').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    outcome: executionOutcome('outcome'),
    error: text('error'),
  },
  (t) => [uniqueIndex('job_executions_job_attempt_uq').on(t.jobId, t.attempt)],
);

/** Idempotency key for transitions and the full status history of a job. */
export const jobTransitions = pgTable(
  'job_transitions',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    attempt: integer('attempt').notNull(),
    toStatus: jobStatus('to_status').notNull(),
    fromStatus: jobStatus('from_status').notNull(),
    actor: text('actor').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.attempt, t.toStatus] })],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityId: uuid('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityId, t.createdAt)],
);

export const outbox = pgTable(
  'outbox',
  {
    /** Also the event id and the `Nats-Msg-Id`. */
    id: uuid('id').primaryKey(),
    subject: text('subject').notNull(),
    payload: jsonb('payload').notNull(),
    /** W3C context of the writing request; the relay publishes inside it. */
    traceContext: jsonb('trace_context').$type<TraceCarrier>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
  },
  (t) => [
    index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

/**
 * Messages a worker has finished with, written in the transaction of the final transition.
 * A redelivery of the same message is then recognised before any work is repeated.
 */
export const inbox = pgTable(
  'inbox',
  {
    consumer: text('consumer').notNull(),
    messageId: text('message_id').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    processedAt: ts('processed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.messageId] })],
);

/** `Idempotency-Key` of `POST /v1/jobs`, kept for a day. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    /** The response as first sent; a replay returns exactly this. */
    response: jsonb('response').$type<JobDto>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idempotency_keys_created_idx').on(t.createdAt),
  ],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    url: text('url').notNull(),
    /** Needed in plain form to sign deliveries, so it cannot be hashed like API keys. */
    secret: text('secret').notNull(),
    events: webhookEvent('events').array().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('webhook_endpoints_user_idx').on(t.userId, t.createdAt)],
);

export type JobRow = typeof jobs.$inferSelect;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
