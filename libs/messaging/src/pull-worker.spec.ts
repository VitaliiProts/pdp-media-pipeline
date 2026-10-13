import { type Consumer, type JsMsg } from '@nats-io/jetstream';
import { ack, type HandlerResult, nak, PullWorker, WorkerShutdownError } from './pull-worker';
import { Semaphore } from './semaphore';

interface FakeMsg {
  subject: string;
  seq: number;
  data: Uint8Array;
  info: { deliveryCount: number };
  headers: undefined;
  ack: jest.Mock;
  nak: jest.Mock;
  term: jest.Mock;
  working: jest.Mock;
}

const message = (seq: number): FakeMsg => ({
  subject: 'jobs.cpu.video.transcode',
  seq,
  data: new Uint8Array(),
  info: { deliveryCount: 1 },
  headers: undefined,
  ack: jest.fn(),
  nak: jest.fn(),
  term: jest.fn(),
  working: jest.fn(),
});

/** A consumer whose fetch hands out queued messages, or waits `expiresMs` for none. */
function fakeConsumer(queue: FakeMsg[]) {
  const fetch = jest.fn(({ expires }: { expires: number }) => {
    const next = queue.shift();
    return Promise.resolve(
      (async function* () {
        if (next) yield next as unknown as JsMsg;
        else await sleep(expires);
      })(),
    );
  });
  return { consumer: { fetch } as unknown as Consumer, fetch };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(queue: FakeMsg[], handler: (signal: AbortSignal) => Promise<HandlerResult>) {
  const { consumer, fetch } = fakeConsumer(queue);
  const worker = new PullWorker({
    name: 'test',
    consumer,
    handler: (_msg, signal) => handler(signal),
    semaphore: new Semaphore(1),
    heartbeatMs: 1000,
    fetchExpiresMs: 20,
  });
  return { worker, fetch };
}

describe('PullWorker.stop', () => {
  it('lets a message that finishes within the grace period end normally', async () => {
    const msg = message(1);
    const { worker } = setup([msg], async (signal) => {
      await sleep(100);
      return signal.aborted ? nak(0) : ack();
    });
    worker.start();
    await sleep(20);

    await worker.stop(1000, 1000);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
  });

  it('aborts a message still running at the deadline, and its handler hands it back', async () => {
    const msg = message(1);
    let reason: unknown;
    const { worker } = setup([msg], (signal) => {
      return new Promise((resolve) =>
        signal.addEventListener('abort', () => {
          reason = signal.reason;
          resolve(nak(0));
        }),
      );
    });
    worker.start();
    await sleep(20);

    const startedAt = Date.now();
    await worker.stop(100, 1000);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(reason).toBeInstanceOf(WorkerShutdownError);
    expect(msg.nak).toHaveBeenCalledWith(0);
  });

  it('gives up on a handler that ignores the abort after the abort grace', async () => {
    const msg = message(1);
    const handled = sleep(400).then(ack);
    const { worker } = setup([msg], () => handled);
    worker.start();
    await sleep(20);

    const startedAt = Date.now();
    await worker.stop(50, 50);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(msg.ack).not.toHaveBeenCalled();
    await handled;
  });

  it('stops pulling at once, even while every slot is busy', async () => {
    const { worker, fetch } = setup([message(1), message(2)], async () => {
      await sleep(100);
      return ack();
    });
    worker.start();
    await sleep(20);

    await worker.stop(1000, 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('naks a message that arrives while stopping instead of processing it', async () => {
    const late = message(2);
    const handler = jest.fn(() => Promise.resolve(ack()));
    const { consumer } = fakeConsumer([]);
    let release: () => void = () => undefined;
    (consumer.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve(
        (async function* () {
          await new Promise<void>((r) => (release = r));
          yield late as unknown as JsMsg;
        })(),
      ),
    );
    const worker = new PullWorker({
      name: 'test',
      consumer,
      handler,
      semaphore: new Semaphore(1),
      heartbeatMs: 1000,
      fetchExpiresMs: 20,
    });
    worker.start();
    await sleep(10);

    const stopped = worker.stop(1000, 1000);
    release();
    await stopped;
    expect(late.nak).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });
});
