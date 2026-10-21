import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type NatsService } from '@pdp/messaging';
import {
  captureTraceContext,
  currentTraceId,
  jobLogFields,
  traced,
  withJobContext,
} from '@pdp/observability';
import { startTestTracing, type TestTracing } from '@pdp/observability/testing';
import { type Env } from '../config';
import { type PostgresService } from '../database/postgres.service';
import { OutboxRelay } from './outbox.relay';

describe('OutboxRelay', () => {
  let tracing: TestTracing;

  beforeAll(() => {
    tracing = startTestTracing();
  });
  afterEach(() => {
    tracing.reset();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  afterAll(() => tracing.stop());

  async function storedJobContext() {
    let traceId: string | null = null;
    let stored: ReturnType<typeof captureTraceContext> = null;
    await traced('create job', {}, () => {
      traceId = currentTraceId();
      withJobContext({ id: 'job-1', type: 'image.resize' }, () => {
        stored = captureTraceContext();
      });
      return Promise.resolve();
    });
    return { traceId, stored };
  }

  function relayWith(row: object, publishJson: NatsService['publishJson']) {
    const query = {
      from: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      for: () => Promise.resolve([row]),
    };
    const tx = { select: () => query, update: jest.fn() };
    const pg = {
      db: { transaction: (fn: (t: typeof tx) => Promise<number>) => fn(tx) },
    } as unknown as PostgresService;
    const config = { get: () => 10 } as unknown as ConfigService<Env, true>;
    return new OutboxRelay(pg, { publishJson } as unknown as NatsService, config);
  }

  it('logs a failed publish once, in the trace and job of the event', async () => {
    const { traceId, stored } = await storedJobContext();
    const logged: { message: unknown; job: Record<string, string>; traceId: string | null }[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logged.push({ message, job: jobLogFields(), traceId: currentTraceId() });
    });
    const row = {
      id: 'event-1',
      subject: 'events.job.created.v1',
      payload: {},
      traceContext: stored,
    };
    const relay = relayWith(row, () => Promise.reject(new Error('jetstream is not enabled')));

    jest.useFakeTimers();
    const loop = relay['run']();
    relay['stopped'] = true;
    await jest.advanceTimersByTimeAsync(1000);
    await loop;

    expect(logged).toEqual([
      {
        message: 'relay failed on events.job.created.v1 event-1: jetstream is not enabled',
        job: { job_id: 'job-1', job_type: 'image.resize' },
        traceId,
      },
    ]);
  });
});
