import { MatchersV3, type PactV4 } from '@pact-foundation/pact';
import {
  dispatchMessageId,
  type JobDispatchV1,
  type JobType,
  type ProgressRequest,
  type TransitionRequest,
  type TransitionResponse,
} from '@pdp/contracts';
import {
  type JobContext,
  type JobOutput,
  type JobProcessor,
  JobRunner,
  PermanentError,
} from '@pdp/worker-kit';
import { errorBody, EXAMPLE, job, metadataAt, pathFromState, timestamp } from './pact';

const { integer, like } = MatchersV3;

export interface RunnerContract {
  type: JobType;
  /** Durable consumer the dispatch arrives on; recorded in the inbox. */
  consumer: string;
  inputSchema: JobProcessor<unknown>['inputSchema'];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const transitionsPath = pathFromState(
  '/internal/jobs/${jobId}/transitions',
  `/internal/jobs/${EXAMPLE.jobId}/transitions`,
);
const inboxOf = (consumer: string) => ({
  consumer,
  messageId: pathFromState(dispatchMessageId('${jobId}', 0), dispatchMessageId(EXAMPLE.jobId, 0)),
});

/**
 * Runs a delivery through the real `JobRunner`. Only the call under test goes to the Pact
 * mock; the runner's other transitions get the status they asked for.
 */
function deliver(
  url: string,
  contract: RunnerContract,
  {
    deliveryCount = 1,
    sendsFor = [] as string[],
    process = (_ctx: JobContext): Promise<JobOutput> => Promise.resolve(contract.output),
  } = {},
) {
  const client = metadataAt(url);
  const asked = (_id: string, body: TransitionRequest) =>
    Promise.resolve({ applied: true, job: { status: body.to } } as TransitionResponse);
  let progressSent: Promise<void> = Promise.resolve();
  const runner = new JobRunner(
    {
      transition: (id, body) =>
        sendsFor.includes(body.to) ? client.transition(id, body) : asked(id, body),
      progress: (id, body: ProgressRequest) => (progressSent = client.reportProgress(id, body)),
    },
    {
      workerId: 'pact',
      retry: { baseMs: 1000, maxMs: 1000 },
      progressIntervalMs: 0,
      transitionRetry: { repeats: 0, delayMs: 1 },
    },
  ).register({
    type: contract.type,
    inputSchema: contract.inputSchema,
    process: async (ctx: JobContext) => {
      const output = await process(ctx);
      await progressSent;
      return output;
    },
  });
  const dispatch: JobDispatchV1 = {
    version: 1,
    jobId: EXAMPLE.jobId,
    type: contract.type,
    class: 'cpu',
    priority: 5,
    input: contract.input,
    attemptBase: 0,
    dispatchedAt: new Date().toISOString(),
  };
  return runner.handle(
    { data: encode(dispatch), deliveryCount, consumer: contract.consumer },
    new AbortController().signal,
  );
}

/** The transitions every worker makes through `JobRunner`, and the answers it acts on. */
export function describeJobRunner(pact: PactV4, contract: RunnerContract): void {
  const { type, consumer, input, output } = contract;
  const jobOf = (fields: Record<string, unknown>) =>
    job({ type, class: 'cpu', input: like(input), attempts: integer(1), ...fields });
  const actor = like('worker:pact');

  describe(`JobRunner on ${type}`, () => {
    it('starts an attempt', () =>
      pact
        .addInteraction()
        .given(`a scheduled ${type} job`)
        .uponReceiving(`the start of the first attempt of a ${type} job`)
        .withRequest('POST', transitionsPath, (b) =>
          b.jsonBody({ to: 'running', attempt: 1, actor, class: 'cpu', inbox: inboxOf(consumer) }),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody({ applied: true, job: jobOf({ status: 'running' }) }),
        )
        .executeTest(async ({ url }) => {
          await expect(deliver(url, contract, { sendsFor: ['running'] })).resolves.toEqual({
            kind: 'ack',
          });
        }));

    it('reports success', () =>
      pact
        .addInteraction()
        .given(`a ${type} job running its first attempt`)
        .uponReceiving(`the success of a ${type} job`)
        .withRequest('POST', transitionsPath, (b) =>
          b.jsonBody({
            to: 'succeeded',
            attempt: 1,
            actor,
            output: like(output),
            inbox: inboxOf(consumer),
          }),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody({
            applied: true,
            job: jobOf({ status: 'succeeded', output: like(output), finishedAt: timestamp }),
          }),
        )
        .executeTest(async ({ url }) => {
          await expect(deliver(url, contract, { sendsFor: ['succeeded'] })).resolves.toEqual({
            kind: 'ack',
          });
        }));

    it('hands a failed attempt back for a retry', () =>
      pact
        .addInteraction()
        .given(`a ${type} job running its first attempt`)
        .uponReceiving(`a retry of a ${type} job`)
        .withRequest('POST', transitionsPath, (b) =>
          b.jsonBody({ to: 'scheduled', attempt: 1, actor, error: like('socket hang up') }),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody({
            applied: true,
            job: jobOf({ status: 'scheduled', lastError: like('socket hang up') }),
          }),
        )
        .executeTest(async ({ url }) => {
          const result = await deliver(url, contract, {
            sendsFor: ['scheduled'],
            process: () => Promise.reject(new Error('socket hang up')),
          });
          expect(result.kind).toBe('nak');
        }));

    it('gives up on a permanent error', () =>
      pact
        .addInteraction()
        .given(`a ${type} job running its first attempt`)
        .uponReceiving(`a permanent failure of a ${type} job`)
        .withRequest('POST', transitionsPath, (b) =>
          b.jsonBody({
            to: 'dead',
            attempt: 1,
            actor,
            error: like('unreadable source'),
            inbox: inboxOf(consumer),
          }),
        )
        .willRespondWith(200, (b) =>
          b.jsonBody({
            applied: true,
            job: jobOf({
              status: 'dead',
              deadReason: like('permanent'),
              lastError: like('unreadable source'),
              finishedAt: timestamp,
            }),
          }),
        )
        .executeTest(async ({ url }) => {
          const result = await deliver(url, contract, {
            sendsFor: ['dead'],
            process: () => Promise.reject(new PermanentError('unreadable source')),
          });
          expect(result).toEqual({ kind: 'ack' });
        }));

    it('drops a delivery of a job that already finished', () =>
      pact
        .addInteraction()
        .given(`a succeeded ${type} job`)
        .uponReceiving(`the start of another attempt of a finished ${type} job`)
        .withRequest('POST', transitionsPath, (b) =>
          b.jsonBody({ to: 'running', attempt: 2, actor, class: 'cpu', inbox: inboxOf(consumer) }),
        )
        .willRespondWith(409, (b) => b.jsonBody(errorBody('JOB_TERMINAL')))
        .executeTest(async ({ url }) => {
          const process = jest.fn(() => Promise.resolve(output));
          await expect(
            deliver(url, contract, { deliveryCount: 2, sendsFor: ['running'], process }),
          ).resolves.toEqual({ kind: 'ack' });
          expect(process).not.toHaveBeenCalled();
        }));

    it('drops the failure of an attempt a later one replaced', () =>
      pact
        .addInteraction()
        .given(`a ${type} job running its second attempt`)
        .uponReceiving(`a permanent failure of a replaced attempt of a ${type} job`)
        .withRequest('POST', transitionsPath, (b) =>
          b.jsonBody({
            to: 'dead',
            attempt: 1,
            actor,
            error: like('unreadable source'),
            inbox: inboxOf(consumer),
          }),
        )
        .willRespondWith(409, (b) => b.jsonBody(errorBody('STALE_ATTEMPT')))
        .executeTest(async ({ url }) => {
          const result = await deliver(url, contract, {
            sendsFor: ['dead'],
            process: () => Promise.reject(new PermanentError('unreadable source')),
          });
          expect(result).toEqual({ kind: 'ack' });
        }));
  });
}

/** Progress of a long job, with the step it is in. */
export function describeProgress(pact: PactV4, contract: RunnerContract): void {
  it(`reports the progress of a ${contract.type} job`, () =>
    pact
      .addInteraction()
      .given(`a ${contract.type} job running its first attempt`)
      .uponReceiving(`progress of a ${contract.type} job`)
      .withRequest(
        'POST',
        pathFromState(
          '/internal/jobs/${jobId}/progress',
          `/internal/jobs/${EXAMPLE.jobId}/progress`,
        ),
        (b) => b.jsonBody({ attempt: 1, progress: integer(40), step: like('translate') }),
      )
      .willRespondWith(204)
      .executeTest(async ({ url }) => {
        await expect(
          deliver(url, contract, {
            process: (ctx) => {
              ctx.progress(40, 'translate');
              return Promise.resolve(contract.output);
            },
          }),
        ).resolves.toEqual({ kind: 'ack' });
      }));
}
