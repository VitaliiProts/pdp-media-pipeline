import { DEFAULT_JOB_PRIORITY, JobCreatedV1, type JobType } from '@pdp/contracts';
import { type Tx } from '../database/postgres.service';
import { auditLog, type JobRow, jobs } from '../database/schema';
import { enqueueEvent } from '../outbox/outbox';

/** A new job and its `job.created` event, which the scheduler dispatches from. */
export async function insertJob(
  tx: Tx,
  values: {
    userId: string;
    type: JobType;
    priority?: number;
    input: Record<string, unknown>;
    actor: string;
  },
): Promise<JobRow> {
  const [job] = await tx
    .insert(jobs)
    .values({
      userId: values.userId,
      type: values.type,
      priority: values.priority ?? DEFAULT_JOB_PRIORITY,
      input: values.input,
    })
    .returning();
  if (!job) throw new Error('insert returned no row');

  await enqueueEvent(tx, JobCreatedV1, {
    jobId: job.id,
    userId: job.userId,
    type: job.type,
    priority: job.priority,
    input: job.input,
    attemptBase: job.attemptBase,
  });
  await tx.insert(auditLog).values({
    actor: values.actor,
    action: 'job.created',
    entityId: job.id,
    data: { type: job.type },
  });
  return job;
}
