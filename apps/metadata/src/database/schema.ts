import { JOB_CLASSES, JOB_STATUSES, JOB_TYPES } from '@pdp/contracts';
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
export const executionOutcome = pgEnum('execution_outcome', [
  'succeeded',
  'retry',
  'failed',
  'abandoned',
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
    lastError: text('last_error'),
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
    createdAt: ts('created_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
  },
  (t) => [
    index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
