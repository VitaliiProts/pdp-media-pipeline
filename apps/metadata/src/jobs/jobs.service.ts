import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateJobRequest,
  DEFAULT_JOB_PRIORITY,
  ImageResizeInputV1,
  JobCreatedV1,
  type JobDto,
  type JobType,
  JobStatusChangedV1,
  type ListJobsResponse,
  type MetadataErrorBody,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import { and, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { PostgresService, type Tx } from '../database/postgres.service';
import { auditLog, jobExecutions, type JobRow, jobs, jobTransitions } from '../database/schema';
import { enqueueEvent } from '../outbox/outbox';
import { decodeCursor, encodeCursor, toJobDto } from './job.mapper';
import { decide, type TransitionEffect } from './state-machine';

const INPUT_SCHEMAS: Partial<Record<JobType, z.ZodType>> = {
  'image.resize': ImageResizeInputV1,
};

const error = (code: MetadataErrorBody['code'], message: string): MetadataErrorBody => ({
  code,
  message,
});

@Injectable()
export class JobsService {
  constructor(private readonly pg: PostgresService) {}

  async create(req: CreateJobRequest): Promise<JobDto> {
    const inputSchema = INPUT_SCHEMAS[req.type];
    if (!inputSchema) {
      throw new BadRequestException(error('VALIDATION_FAILED', `unsupported job type ${req.type}`));
    }
    const input = inputSchema.safeParse(req.input);
    if (!input.success) {
      throw new BadRequestException(error('VALIDATION_FAILED', z.prettifyError(input.error)));
    }

    const row = await this.pg.db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobs)
        .values({
          userId: req.userId,
          type: req.type,
          priority: req.priority ?? DEFAULT_JOB_PRIORITY,
          input: input.data as Record<string, unknown>,
        })
        .returning();
      if (!job) throw new Error('insert returned no row');

      await enqueueEvent(tx, JobCreatedV1, {
        jobId: job.id,
        userId: job.userId,
        type: job.type,
        priority: job.priority,
        input: job.input,
      });
      await tx.insert(auditLog).values({
        actor: `user:${job.userId}`,
        action: 'job.created',
        entityId: job.id,
        data: { type: job.type },
      });
      return job;
    });
    return toJobDto(row);
  }

  async get(id: string): Promise<JobDto> {
    const [row] = await this.pg.db.select().from(jobs).where(eq(jobs.id, id));
    if (!row) throw new NotFoundException(error('JOB_NOT_FOUND', `job ${id} not found`));
    return toJobDto(row);
  }

  async list(query: {
    userId: string;
    status?: JobRow['status'];
    limit: number;
    cursor?: string;
  }): Promise<ListJobsResponse> {
    const filters: SQL[] = [eq(jobs.userId, query.userId)];
    if (query.status) filters.push(eq(jobs.status, query.status));
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
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
      if (!job) throw new NotFoundException(error('JOB_NOT_FOUND', `job ${id} not found`));

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

      const decision = decide(job, req, existing !== undefined);
      if (decision.kind === 'reject') {
        throw new ConflictException(error(decision.code, decision.message));
      }
      if (decision.kind === 'noop') return { applied: false, job };

      const updated = await this.applyEffect(tx, job, req, decision.effect);
      await tx.insert(jobTransitions).values({
        jobId: id,
        attempt: req.attempt,
        toStatus: req.to,
        fromStatus: decision.from,
        actor: req.actor,
      });
      await enqueueEvent(tx, JobStatusChangedV1, {
        jobId: id,
        userId: updated.userId,
        type: updated.type,
        from: decision.from,
        to: req.to,
        class: updated.class,
        attempt: req.attempt,
        reason: req.error,
      });
      return { applied: true, job: updated };
    });
    return { applied: result.applied, job: toJobDto(result.job) };
  }

  private async applyEffect(
    tx: Tx,
    job: JobRow,
    req: TransitionRequest,
    effect: TransitionEffect,
  ): Promise<JobRow> {
    const now = new Date();
    const patch: Partial<JobRow> = { status: req.to, updatedAt: now };
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

    switch (effect) {
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

      case 'succeed':
        await tx
          .update(jobExecutions)
          .set({ finishedAt: now, outcome: 'succeeded', error: null })
          .where(thisExecution);
        await abandon(`job succeeded on attempt ${req.attempt}`);
        patch.output = req.output ?? null;
        patch.finishedAt = now;
        break;

      case 'fail':
        await tx
          .update(jobExecutions)
          .set({ finishedAt: now, outcome: 'failed', error: req.error ?? null })
          .where(thisExecution);
        await abandon(`job failed on attempt ${req.attempt}`);
        patch.lastError = req.error ?? null;
        patch.finishedAt = now;
        break;
    }

    const [updated] = await tx.update(jobs).set(patch).where(eq(jobs.id, job.id)).returning();
    if (!updated) throw new Error('update returned no row');
    return updated;
  }
}
