import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CreateJobRequest,
  type CreateJobResponse,
  deadLetterSubject,
  ImageResizeInputV1,
  isMediaJobType,
  JobCreatedV1,
  JobDeadLetteredV1,
  type JobDto,
  type JobType,
  JobStatusChangedV1,
  type ListJobsResponse,
  type MetadataErrorBody,
  type ProgressRequest,
  type RedriveRequest,
  type TransitionRequest,
  type TransitionResponse,
  VideoDubInputV1,
  VideoFramesInputV1,
  VideoTranscodeInputV1,
} from '@pdp/contracts';
import { currentTraceId, jobMetrics, withJobContext } from '@pdp/observability';
import { and, count, desc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AssetsService } from '../assets/assets.service';
import { type Env } from '../config';
import { PostgresService, type Tx } from '../database/postgres.service';
import {
  auditLog,
  idempotencyKeys,
  inbox,
  jobExecutions,
  type JobRow,
  jobs,
  jobTransitions,
} from '../database/schema';
import { enqueueEvent } from '../outbox/outbox';
import { WebhooksService } from '../webhooks/webhooks.service';
import { insertJob } from './insert-job';
import { decodeCursor, encodeCursor, toJobDto } from './job.mapper';
import {
  decide,
  type Decision,
  decideProgress,
  decideRedrive,
  type RetryPolicy,
} from './state-machine';

/** Types clients may create; `webhook.deliver` jobs are only created by Metadata itself. */
const INPUT_SCHEMAS: Partial<Record<JobType, z.ZodType>> = {
  'image.resize': ImageResizeInputV1,
  'video.frames': VideoFramesInputV1,
  'video.transcode': VideoTranscodeInputV1,
  'video.dub': VideoDubInputV1,
};

const error = (code: MetadataErrorBody['code'], message: string): MetadataErrorBody => ({
  code,
  message,
});

type AppliedDecision = Extract<Decision, { kind: 'apply' }>;
type Idempotency = NonNullable<CreateJobRequest['idempotency']>;

const seconds = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / 1000);

@Injectable()
export class JobsService {
  private readonly policy: RetryPolicy;
  private readonly idempotencyTtlHours: number;

  constructor(
    private readonly pg: PostgresService,
    private readonly webhooks: WebhooksService,
    private readonly assets: AssetsService,
    config: ConfigService<Env, true>,
  ) {
    this.policy = { maxAttempts: config.get('JOB_MAX_ATTEMPTS', { infer: true }) };
    this.idempotencyTtlHours = config.get('IDEMPOTENCY_TTL_HOURS', { infer: true });
  }

  async create(req: CreateJobRequest): Promise<CreateJobResponse> {
    const inputSchema = INPUT_SCHEMAS[req.type];
    if (!inputSchema) {
      throw new BadRequestException(error('VALIDATION_FAILED', `unsupported job type ${req.type}`));
    }
    const input = inputSchema.safeParse(req.input);
    if (!input.success) {
      throw new BadRequestException(error('VALIDATION_FAILED', z.prettifyError(input.error)));
    }
    if (req.type === 'video.dub') await this.checkReuse(req.userId, input.data as VideoDubInputV1);

    const created = await this.pg.db.transaction(async (tx) => {
      if (req.idempotency) {
        const replay = await this.claimIdempotencyKey(tx, req.userId, req.idempotency);
        if (replay) return { job: replay, replayed: true };
      }

      const { sourceKey } = input.data as { sourceKey?: string };
      const job = await insertJob(tx, {
        userId: req.userId,
        type: req.type,
        priority: req.priority,
        input: input.data as Record<string, unknown>,
        assetId: sourceKey ? await this.assets.attachForJob(tx, req.userId, sourceKey) : null,
        actor: `user:${req.userId}`,
      });

      const dto = toJobDto(job);
      if (req.idempotency) {
        await tx.insert(idempotencyKeys).values({
          userId: req.userId,
          key: req.idempotency.key,
          requestHash: req.idempotency.requestHash,
          jobId: job.id,
          response: dto,
        });
      }
      return { job: dto, replayed: false };
    });
    if (!created.replayed) jobMetrics.created(created.job.type);
    return created;
  }

  /**
   * The worker copies the recognised speech and audio of `reuseOf`, so it must be a dub of the
   * same file by the same user. Any state will do: a dub that failed on `same_language` has them.
   * A job of another user is answered like a missing one.
   */
  private async checkReuse(userId: string, input: VideoDubInputV1): Promise<void> {
    if (!input.reuseOf) return;
    const [previous] = await this.pg.db
      .select({ input: jobs.input })
      .from(jobs)
      .where(and(eq(jobs.id, input.reuseOf), eq(jobs.userId, userId), eq(jobs.type, 'video.dub')))
      .limit(1);
    const previousKey = (previous?.input as { sourceKey?: string } | undefined)?.sourceKey;
    if (previousKey !== input.sourceKey) {
      throw new BadRequestException(
        error('VALIDATION_FAILED', 'reuseOf must name a dub of the same file'),
      );
    }
  }

  /**
   * Serialises requests with the same key on a transaction-scoped advisory lock: the holder
   * creates the job and stores the response before the lock goes away at commit, so a
   * concurrent request either sees the key busy or finds the stored response.
   *
   * @returns the stored response to replay, or null when this request owns the key
   */
  private async claimIdempotencyKey(
    tx: Tx,
    userId: string,
    { key, requestHash }: Idempotency,
  ): Promise<JobDto | null> {
    const { rows } = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${`${userId}:${key}`}, 0)) as locked`,
    );
    if (!rows[0]?.locked) {
      throw new ConflictException(
        error('IDEMPOTENCY_KEY_IN_PROGRESS', 'a request with this Idempotency-Key is in progress'),
      );
    }

    const sameKey = and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key));
    await tx
      .delete(idempotencyKeys)
      .where(and(sameKey, lte(idempotencyKeys.createdAt, this.expiry())));
    const [stored] = await tx.select().from(idempotencyKeys).where(sameKey);
    if (!stored) return null;
    if (stored.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        error('IDEMPOTENCY_KEY_REUSED', 'this Idempotency-Key was used with a different request'),
      );
    }
    return stored.response;
  }

  /** Removes keys past their TTL; returns how many. */
  async purgeIdempotencyKeys(): Promise<number> {
    const deleted = await this.pg.db
      .delete(idempotencyKeys)
      .where(lte(idempotencyKeys.createdAt, this.expiry()))
      .returning({ key: idempotencyKeys.key });
    return deleted.length;
  }

  private expiry(): SQL {
    return sql`now() - make_interval(hours => ${this.idempotencyTtlHours})`;
  }

  async get(id: string): Promise<JobDto> {
    const [row] = await this.pg.db.select().from(jobs).where(eq(jobs.id, id));
    if (!row) throw new NotFoundException(error('JOB_NOT_FOUND', `job ${id} not found`));
    return toJobDto(row);
  }

  async list(query: {
    userId: string;
    status?: JobRow['status'];
    types?: JobType[];
    webhookEndpointId?: string;
    assetId?: string;
    limit: number;
    cursor?: string;
  }): Promise<ListJobsResponse> {
    const filters: SQL[] = [eq(jobs.userId, query.userId)];
    if (query.status) filters.push(eq(jobs.status, query.status));
    if (query.types) filters.push(inArray(jobs.type, query.types));
    if (query.assetId) filters.push(eq(jobs.assetId, query.assetId));
    if (query.webhookEndpointId) {
      filters.push(sql`(${jobs.input}->>'endpointId') = ${query.webhookEndpointId}`);
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (!cursor) throw new BadRequestException(error('VALIDATION_FAILED', 'invalid cursor'));
      filters.push(sql`(${jobs.createdAt}, ${jobs.id}) < (${cursor.createdAt}, ${cursor.id})`);
    }

    const rows = await this.pg.db
      .select()
      .from(jobs)
      .where(and(...filters))
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toJobDto),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * The only way a job changes status. Locks the job row, so concurrent calls for
   * the same job serialize and a repeated (jobId, attempt, to) becomes a no-op.
   */
  async transition(id: string, req: TransitionRequest): Promise<TransitionResponse> {
    const result = await this.pg.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, id);

      const [existing] = await tx
        .select({ attempt: jobTransitions.attempt })
        .from(jobTransitions)
        .where(
          and(
            eq(jobTransitions.jobId, id),
            eq(jobTransitions.attempt, req.attempt),
            eq(jobTransitions.toStatus, req.to),
          ),
        );

      if (!existing && req.inbox && (await this.inInbox(tx, req.inbox))) {
        jobMetrics.duplicate('inbox');
        throw new ConflictException(
          error('DUPLICATE_DELIVERY', `message ${req.inbox.messageId} was already processed`),
        );
      }

      const [started] = await tx
        .select({ n: count() })
        .from(jobExecutions)
        .where(
          and(
            eq(jobExecutions.jobId, id),
            gt(jobExecutions.attempt, job.attemptBase),
            or(isNull(jobExecutions.outcome), ne(jobExecutions.outcome, 'interrupted')),
          ),
        );
      const startedInGeneration = started?.n ?? 0;
      const decision = decide(
        { ...job, startedInGeneration },
        req,
        existing !== undefined,
        this.policy,
      );
      if (decision.kind === 'reject') {
        throw new ConflictException(error(decision.code, decision.message));
      }
      if (decision.kind === 'noop') return { applied: false as const, job };

      const updated = await this.applyEffect(tx, job, req, decision);
      await tx.insert(jobTransitions).values({
        jobId: id,
        attempt: req.attempt,
        toStatus: decision.to,
        fromStatus: decision.from,
        actor: req.actor,
      });
      if (decision.effect === 'succeed') await this.assets.recordSourceFacts(tx, updated);
      if (req.inbox && (decision.effect === 'succeed' || decision.effect === 'dead')) {
        await tx
          .insert(inbox)
          .values({ ...req.inbox, jobId: id })
          .onConflictDoNothing();
      }
      await enqueueEvent(tx, JobStatusChangedV1, {
        jobId: id,
        userId: updated.userId,
        type: updated.type,
        from: decision.from,
        to: decision.to,
        class: updated.class,
        attempt: req.attempt,
        reason: decision.deadReason ? `${decision.deadReason}: ${updated.lastError}` : req.error,
      });
      if (decision.effect === 'dead') {
        await enqueueEvent(
          tx,
          JobDeadLetteredV1,
          {
            jobId: id,
            userId: updated.userId,
            type: updated.type,
            class: updated.class,
            reason: decision.deadReason ?? 'permanent',
            attempts: updated.attempts,
            lastError: updated.lastError,
            input: updated.input,
          },
          deadLetterSubject(updated.type),
        );
      }
      // Deliveries do not notify about themselves, or a failing endpoint would feed itself.
      let deliveries = 0;
      if (
        isMediaJobType(updated.type) &&
        (decision.effect === 'succeed' || decision.effect === 'dead')
      ) {
        deliveries = await this.webhooks.enqueueDeliveries(
          tx,
          updated,
          decision.effect === 'succeed' ? 'job.succeeded' : 'job.dead',
        );
      }
      return {
        applied: true as const,
        job: updated,
        decision,
        before: job,
        deliveries,
      };
    });

    if (result.applied) {
      this.countEffect(result.before, result.job, result.decision);
      if (result.deliveries > 0) jobMetrics.created('webhook.deliver', result.deliveries);
    }
    return { applied: result.applied, job: toJobDto(result.job) };
  }

  /**
   * One conditional update instead of a locked transaction: progress arrives every few
   * seconds from a long job, and it must not queue behind status changes for the row lock.
   * The condition is `decideProgress`; when it fails the job is read again for the reason.
   */
  async progress(id: string, req: ProgressRequest): Promise<void> {
    const updated = await this.pg.db
      .update(jobs)
      .set({ progress: req.progress, progressStep: req.step ?? null })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.attempts, req.attempt)))
      .returning({ id: jobs.id });
    if (updated.length > 0) return;

    const [job] = await this.pg.db
      .select({ status: jobs.status, attempts: jobs.attempts })
      .from(jobs)
      .where(eq(jobs.id, id));
    if (!job) throw new NotFoundException(error('JOB_NOT_FOUND', `job ${id} not found`));
    const rejected = decideProgress(job, req.attempt) ?? {
      code: 'STALE_ATTEMPT' as const,
      message: `attempt ${req.attempt} was superseded`,
    };
    throw new ConflictException(error(rejected.code, rejected.message));
  }

  /**
   * Sends a dead job through the pipeline again as a new generation: attempts restart
   * above the current ones, so the old executions neither count nor collide.
   */
  async redrive(id: string, req: RedriveRequest): Promise<JobDto> {
    const row = await this.pg.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, id);
      const decision = decideRedrive(job);
      if (decision.kind === 'reject') {
        throw new ConflictException(error('NOT_REDRIVABLE', decision.message));
      }
      if (job.assetId && (await this.assets.isDeleted(tx, job.assetId))) {
        throw new ConflictException(error('NOT_REDRIVABLE', 'the file of this job was deleted'));
      }
      return withJobContext({ id: job.id, type: job.type, class: job.class }, () =>
        this.requeue(tx, job, req),
      );
    });
    return toJobDto(row);
  }

  /** The new generation is traced from the redrive request on. */
  private async requeue(tx: Tx, job: JobRow, req: RedriveRequest): Promise<JobRow> {
    const attemptBase = job.attempts + 1;
    const [updated] = await tx
      .update(jobs)
      .set({
        status: 'queued',
        attemptBase,
        deadReason: null,
        finishedAt: null,
        traceId: currentTraceId() ?? job.traceId,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id))
      .returning();
    if (!updated) throw new Error('update returned no row');

    await tx.insert(jobTransitions).values({
      jobId: job.id,
      attempt: attemptBase,
      toStatus: 'queued',
      fromStatus: job.status,
      actor: req.actor,
    });
    await enqueueEvent(tx, JobStatusChangedV1, {
      jobId: job.id,
      userId: updated.userId,
      type: updated.type,
      from: job.status,
      to: 'queued',
      class: updated.class,
      attempt: attemptBase,
      reason: 'redrive',
    });
    // The scheduler dispatches on job.created; the new base makes its Nats-Msg-Id new too.
    await enqueueEvent(tx, JobCreatedV1, {
      jobId: job.id,
      userId: updated.userId,
      type: updated.type,
      priority: updated.priority,
      input: updated.input,
      attemptBase,
    });
    await tx.insert(auditLog).values({
      actor: req.actor,
      action: 'job.redriven',
      entityId: job.id,
      data: { attemptBase, deadReason: job.deadReason },
    });
    return updated;
  }

  private async lockJob(tx: Tx, id: string): Promise<JobRow> {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
    if (!job) throw new NotFoundException(error('JOB_NOT_FOUND', `job ${id} not found`));
    return job;
  }

  private async inInbox(tx: Tx, key: NonNullable<TransitionRequest['inbox']>): Promise<boolean> {
    const [row] = await tx
      .select({ jobId: inbox.jobId })
      .from(inbox)
      .where(and(eq(inbox.consumer, key.consumer), eq(inbox.messageId, key.messageId)));
    return row !== undefined;
  }

  /** Runs after commit, so a rolled back transition is not counted. */
  private countEffect(before: JobRow, job: JobRow, decision: AppliedDecision): void {
    switch (decision.effect) {
      case 'start':
        // Only the first attempt of the generation: later ones would add the retry backoff
        // or the time an interrupted attempt ran.
        if (before.attempts <= before.attemptBase) {
          jobMetrics.queueWait(job, seconds(before.updatedAt, job.updatedAt));
        }
        break;
      case 'retry':
        jobMetrics.retry(job.type);
        break;
      case 'interrupt':
        jobMetrics.interrupted(job.type);
        break;
      case 'succeed':
      case 'dead': {
        const reason = decision.deadReason ?? 'permanent';
        if (decision.effect === 'dead') jobMetrics.deadLettered(job.type, reason);
        const e2e =
          job.attemptBase === 0 && job.finishedAt ? seconds(job.createdAt, job.finishedAt) : null;
        jobMetrics.finished(job, decision.effect === 'succeed' ? 'succeeded' : reason, e2e);
        break;
      }
    }
  }

  private async applyEffect(
    tx: Tx,
    job: JobRow,
    req: TransitionRequest,
    decision: AppliedDecision,
  ): Promise<JobRow> {
    const now = new Date();
    const patch: Partial<JobRow> = { status: decision.to, updatedAt: now };
    const thisExecution = and(
      eq(jobExecutions.jobId, job.id),
      eq(jobExecutions.attempt, req.attempt),
    );
    const otherOpenExecutions = and(
      eq(jobExecutions.jobId, job.id),
      ne(jobExecutions.attempt, req.attempt),
      isNull(jobExecutions.finishedAt),
    );
    const abandon = (reason: string) =>
      tx
        .update(jobExecutions)
        .set({ finishedAt: now, outcome: 'abandoned', error: reason })
        .where(otherOpenExecutions);

    switch (decision.effect) {
      case 'schedule':
        patch.class = req.class ?? job.class;
        break;

      case 'start':
        await abandon(`superseded by attempt ${req.attempt}`);
        await tx
          .insert(jobExecutions)
          .values({ jobId: job.id, attempt: req.attempt, workerId: req.actor, startedAt: now })
          .onConflictDoNothing();
        patch.attempts = req.attempt;
        patch.progress = null;
        patch.progressStep = null;
        // The scheduler's own transition is a no-op when the worker overtook it.
        patch.class = job.class ?? req.class ?? null;
        break;

      case 'retry':
        await tx
          .update(jobExecutions)
          .set({ finishedAt: now, outcome: 'retry', error: req.error ?? null })
          .where(thisExecution);
        patch.lastError = req.error ?? null;
        break;

      case 'interrupt':
        // lastError stays: an interruption says nothing about the job.
        await tx
          .update(jobExecutions)
          .set({ finishedAt: now, outcome: 'interrupted', error: req.error ?? null })
          .where(thisExecution);
        break;

      case 'succeed':
        await tx
          .update(jobExecutions)
          .set({ finishedAt: now, outcome: 'succeeded', error: null })
          .where(thisExecution);
        await abandon(`job succeeded on attempt ${req.attempt}`);
        patch.output = req.output ?? null;
        patch.finishedAt = now;
        break;

      case 'dead':
        // No execution row when a crash loop ends at the start of the next delivery.
        await tx
          .update(jobExecutions)
          .set({ finishedAt: now, outcome: 'failed', error: req.error ?? null })
          .where(and(thisExecution, isNull(jobExecutions.finishedAt)));
        await abandon(`job dead on attempt ${req.attempt}`);
        patch.deadReason = decision.deadReason ?? 'permanent';
        patch.lastError =
          req.error ??
          job.lastError ??
          `${this.policy.maxAttempts} attempts started and none finished`;
        patch.finishedAt = now;
        break;
    }

    const [updated] = await tx.update(jobs).set(patch).where(eq(jobs.id, job.id)).returning();
    if (!updated) throw new Error('update returned no row');
    return updated;
  }
}
