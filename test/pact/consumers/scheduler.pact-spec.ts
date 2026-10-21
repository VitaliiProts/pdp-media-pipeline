import { dispatchMessageId, dispatchSubject, type JobCreatedV1 } from '@pdp/contracts';
import { JobCreatedHandler } from '../../../apps/scheduler/src/dispatch/job-created.handler';
import { DISPATCH_INPUTS, JOB_CREATED, jobCreatedMessage, messageBytes } from '../support/messages';
import { EXAMPLE, job, metadataAt, pactBetween, pathFromState } from '../support/pact';

const pact = pactBetween('scheduler', 'metadata');

const jobCreated: JobCreatedV1 = {
  eventId: '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f',
  type: 'job.created',
  version: 1,
  occurredAt: '2026-10-21T12:00:00.000Z',
  payload: {
    jobId: EXAMPLE.jobId,
    userId: EXAMPLE.userId,
    type: 'image.resize',
    priority: 5,
    input: DISPATCH_INPUTS['image.resize'],
    attemptBase: 0,
  },
};

describe('scheduler → metadata', () => {
  it('marks a dispatched job scheduled in its class', () =>
    pact
      .addInteraction()
      .given('a queued image job')
      .uponReceiving('a job scheduled after its dispatch')
      .withRequest(
        'POST',
        pathFromState(
          '/internal/jobs/${jobId}/transitions',
          `/internal/jobs/${EXAMPLE.jobId}/transitions`,
        ),
        (b) => b.jsonBody({ to: 'scheduled', attempt: 0, actor: 'scheduler', class: 'cpu' }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ applied: true, job: job({ status: 'scheduled', class: 'cpu' }) }),
      )
      .executeTest(async ({ url }) => {
        const client = metadataAt(url);
        const handler = new JobCreatedHandler({
          publish: () => Promise.resolve({ duplicate: false }),
          transition: (id, body) => client.transition(id, body),
        });
        const result = await handler.handle(new TextEncoder().encode(JSON.stringify(jobCreated)));
        expect(result).toEqual({ kind: 'ack' });
      }));

  it('dispatches a created job', () =>
    pact
      .addAsynchronousInteraction()
      .given('a queued image job')
      .expectsToReceive(JOB_CREATED, (b) =>
        b.withJSONContent(jobCreatedMessage.content).withMetadata(jobCreatedMessage.metadata),
      )
      .executeTest(async (message) => {
        const publish = jest.fn(() => Promise.resolve({ duplicate: false }));
        const handler = new JobCreatedHandler({
          publish,
          transition: (_id, body) =>
            Promise.resolve({ applied: true, job: job({ status: body.to }) as never }),
        });
        await expect(handler.handle(messageBytes(message.contents.content))).resolves.toEqual({
          kind: 'ack',
        });
        expect(publish).toHaveBeenCalledWith(
          dispatchSubject('cpu', 'image.resize'),
          expect.objectContaining({ jobId: EXAMPLE.jobId, attemptBase: 0 }),
          dispatchMessageId(EXAMPLE.jobId, 0),
        );
      }));
});
