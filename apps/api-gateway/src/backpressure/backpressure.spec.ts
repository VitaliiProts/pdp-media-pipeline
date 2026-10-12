import { HttpStatus } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type NatsService } from '@pdp/messaging';
import { RetryLaterException } from '../common/retry-later';
import { type Env } from '../config';
import { BackpressureService } from './backpressure.service';
import { QueueDepthService } from './queue-depth.service';

const ENV: Partial<Env> = {
  QUEUE_DEPTH_CACHE_MS: 1000,
  BACKPRESSURE_MAX_DEPTH_CPU: 100,
  BACKPRESSURE_MAX_DEPTH_IO: 100,
  BACKPRESSURE_MAX_DEPTH_PRIORITY: 10,
  BACKPRESSURE_RETRY_AFTER_S: 5,
};
const config = { get: (key: keyof Env) => ENV[key] } as unknown as ConfigService<Env, true>;

function setup() {
  const depths: Record<string, number> = { JOBS_CPU: 0, JOBS_IO: 0, JOBS_PRIORITY: 0 };
  const info = jest.fn((name: string) => Promise.resolve({ state: { messages: depths[name] } }));
  const nats = { manager: () => Promise.resolve({ streams: { info } }) } as unknown as NatsService;
  const queue = new QueueDepthService(nats, config);
  return { depths, info, queue, backpressure: new BackpressureService(queue, config) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('QueueDepthService', () => {
  afterEach(() => jest.useRealTimers());

  it('reads every class stream once per cache period', async () => {
    jest.useFakeTimers({ now: 0, doNotFake: ['setImmediate'] });
    const { queue, info, depths } = setup();
    depths.JOBS_CPU = 42;

    await expect(Promise.all([queue.depthOf('cpu'), queue.depthOf('cpu')])).resolves.toEqual([
      42, 42,
    ]);
    await queue.depthOf('priority');
    expect(info).toHaveBeenCalledTimes(3);
  });

  it('serves the stale value while refreshing in the background', async () => {
    jest.useFakeTimers({ now: 0, doNotFake: ['setImmediate'] });
    const { queue, depths } = setup();
    depths.JOBS_CPU = 1;
    await queue.depthOf('cpu');

    depths.JOBS_CPU = 2;
    jest.setSystemTime(1000);
    await expect(queue.depthOf('cpu')).resolves.toBe(1);
    await flush();
    await expect(queue.depthOf('cpu')).resolves.toBe(2);
  });

  it('reports an unknown depth when NATS has been failing for too long', async () => {
    jest.useFakeTimers({ now: 0, doNotFake: ['setImmediate'] });
    const { queue, info } = setup();
    await queue.depthOf('cpu');

    info.mockRejectedValue(new Error('timeout'));
    jest.setSystemTime(5000);
    await expect(queue.depthOf('cpu')).resolves.toBe(0);
    jest.setSystemTime(10_001);
    await expect(queue.depthOf('cpu')).resolves.toBeNull();
  });
});

describe('BackpressureService', () => {
  it('admits jobs while the class stream is below its limit', async () => {
    const { backpressure, depths } = setup();
    depths.JOBS_CPU = 99;
    await expect(backpressure.assertAccepting('cpu')).resolves.toBeUndefined();
  });

  it('sheds load with 503 and Retry-After once the limit is reached', async () => {
    const { backpressure, depths } = setup();
    depths.JOBS_CPU = 100;

    const error = await backpressure.assertAccepting('cpu').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryLaterException);
    expect(error).toMatchObject({ retryAfterS: 5 });
    expect((error as RetryLaterException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('judges each class by its own stream', async () => {
    const { backpressure, depths } = setup();
    depths.JOBS_CPU = 1000;
    await expect(backpressure.assertAccepting('priority')).resolves.toBeUndefined();
  });

  it('admits jobs when the depth is unknown', async () => {
    const { backpressure, info } = setup();
    info.mockRejectedValue(new Error('nats down'));
    await expect(backpressure.assertAccepting('cpu')).resolves.toBeUndefined();
  });
});
