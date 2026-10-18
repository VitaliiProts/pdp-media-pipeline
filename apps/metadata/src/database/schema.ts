import {
  ASSET_KINDS,
  DEAD_REASONS,
  JOB_CLASSES,
  JOB_STATUSES,
  JOB_TYPES,
  type JobDto,
  type UploadContentType,
  WEBHOOK_EVENTS,
} from '@pdp/contracts';
import { type TraceCarrier } from '@pdp/observability';
import { sql } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
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
export const assetKind = pgEnum('asset_kind', ASSET_KINDS);
export const executionOutcome = pgEnum('execution_outcome', [
  'succeeded',
  'retry',
  'failed',
  'abandoned',
  'interrupted',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Lower case; null for users that only have API keys (`seed:user`). */
    email: text('email'),
    /** argon2id in PHC format, parameters included; null when the user cannot log in. */
    passwordHash: text('password_hash'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  // On lower(): the application lower-cases, the index holds even if a row slips through.
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /** SHA-256 of the key; the key itself is shown once and never stored. */
    hash: text('hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** Updated at most once a minute, so a busy key does not write on every lookup. */
    lastUsedAt: ts('last_used_at'),
    /** Revoked keys stay for the audit trail and the list of what a user once had. */
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('api_keys_user_idx').on(t.userId, t.createdAt)],
);

/** A file the user uploaded; jobs read it, and deleting it removes their results too. */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull().unique(),
    kind: assetKind('kind').notNull(),
    name: text('name'),
    contentType: text('content_type').$type<UploadContentType>().notNull(),
    /** Declared at upload and signed into the URL, so it is the stored size; null if older. */
    size: bigint('size', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: doublePrecision('duration_seconds'),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** First job on the asset. Until then the upload only reserves quota and is not listed. */
    attachedAt: ts('attached_at'),
    /** Set together with the `asset.deleted` event; objects are purged after it. */
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    // Live assets only: the library, the quota sum and the kind filter never see deleted ones.
    index('assets_user_created_idx')
      .on(t.userId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
    index('assets_user_kind_created_idx')
      .on(t.userId, t.kind, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
    // What the janitor scans: uploads no job has used yet.
    index('assets_unattached_idx')
      .on(t.createdAt)
      .where(sql`${t.attachedAt} is null and ${t.deletedAt} is null`),
  ],
);

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
    /** Step of the current attempt, for job types made of several; kept and reset with `progress`. */
    progressStep: text('progress_step'),
    /** Set from `input.sourceKey`; URL sources and webhook deliveries have none. */
    assetId: uuid('asset_id').references(() => assets.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('jobs_user_created_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('jobs_asset_created_idx')
      .on(t.assetId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.assetId} is not null`),
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

export type UserRow = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
