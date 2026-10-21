import { Verifier } from '@pact-foundation/pact';
import {
  JOB_TYPES,
  type JobCreatedV1,
  type JobDispatchV1,
  type JobType,
  type TransitionResponse,
} from '@pdp/contracts';
import { randomUUID } from 'node:crypto';
import { JobCreatedHandler } from '../../apps/scheduler/src/dispatch/job-created.handler';
import {
  DISPATCH_INPUTS,
  DISPATCH_PRIORITY,
  dispatchDescription,
  messageBytes,
} from './support/messages';
import { pactsOf } from './support/pact';

/** Runs the real handler on a `job.created` of the type and returns what it published. */
async function dispatchOf(type: JobType) {
  let published: { subject: string; data: JobDispatchV1 } | undefined;
  const handler = new JobCreatedHandler({
    publish: (subject, data) => {
      published = { subject, data };
      return Promise.resolve({ duplicate: false });
    },
    transition: () => Promise.resolve({ applied: true } as TransitionResponse),
  });
  const event: JobCreatedV1 = {
    eventId: randomUUID(),
    type: 'job.created',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      jobId: randomUUID(),
      userId: randomUUID(),
      type,
      priority: DISPATCH_PRIORITY,
      input: DISPATCH_INPUTS[type],
      attemptBase: 0,
    },
  };
  await handler.handle(messageBytes(event));
  if (!published) throw new Error(`no dispatch for ${type}`);
  return { __pactMessageMetadata: { subject: published.subject }, message: published.data };
}

describe('scheduler honours the contracts of the workers', () => {
  it('verifies every dispatch', async () => {
    await new Verifier({
      provider: 'scheduler',
      pactUrls: pactsOf('scheduler'),
      logLevel: 'warn',
      messageProviders: Object.fromEntries(
        JOB_TYPES.map((type) => [dispatchDescription(type), () => dispatchOf(type)]),
      ),
    }).verifyProvider();
  });
});
