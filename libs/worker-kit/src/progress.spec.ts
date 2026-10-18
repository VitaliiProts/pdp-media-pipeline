import { MetadataError } from '@pdp/metadata-client';
import { ProgressReporter } from './progress';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(send = jest.fn((_percent: number, _step?: string) => Promise.resolve())) {
  let now = 0;
  const reporter = new ProgressReporter(send, { intervalMs: 3000, now: () => now });
  const at = (ms: number) => {
    now = ms;
  };
  return { send, report: reporter.report, at };
}

describe('ProgressReporter', () => {
  it('sends at most one update per interval', async () => {
    const { send, report, at } = setup();
    report(10);
    await flush();
    at(1000);
    report(20);
    at(3000);
    report(30);
    await flush();
    expect(send.mock.calls.map(([p]) => p)).toEqual([10, 30]);
  });

  it('rounds down, clamps and never goes backwards', async () => {
    const { send, report, at } = setup();
    report(99.9);
    await flush();
    at(3000);
    report(50);
    at(6000);
    report(140);
    await flush();
    expect(send.mock.calls.map(([p]) => p)).toEqual([99, 100]);
  });

  it('does not send while the previous update is still in flight', async () => {
    let resolve: () => void = () => undefined;
    const send = jest.fn((_percent: number) => new Promise<void>((r) => (resolve = r)));
    const { report, at } = setup(send);
    report(10);
    at(5000);
    report(20);
    expect(send).toHaveBeenCalledTimes(1);
    resolve();
    await flush();
    at(10_000);
    report(30);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps trying after Metadata was unavailable', async () => {
    const send = jest
      .fn((_percent: number) => Promise.resolve())
      .mockRejectedValueOnce(new MetadataError(503, undefined, 'down'));
    const { report, at } = setup(send);
    report(10);
    await flush();
    at(3000);
    report(10);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends the step along with the percent', async () => {
    const { send, report } = setup();
    report(10, 'separate');
    await flush();
    expect(send.mock.calls).toEqual([[10, 'separate']]);
  });

  it('sends a new step at once, even at the same percent', async () => {
    const { send, report, at } = setup();
    report(45, 'separate');
    await flush();
    at(500);
    report(45, 'align');
    at(1000);
    report(46, 'align');
    await flush();
    expect(send.mock.calls).toEqual([
      [45, 'separate'],
      [45, 'align'],
    ]);
  });

  it('keeps the percent from going back when the step changes', async () => {
    const { send, report, at } = setup();
    report(50, 'translate');
    await flush();
    at(500);
    report(40, 'voice');
    await flush();
    expect(send.mock.calls).toEqual([
      [50, 'translate'],
      [50, 'voice'],
    ]);
  });

  it('stops once Metadata says the attempt is no longer running', async () => {
    const send = jest
      .fn((_percent: number) => Promise.resolve())
      .mockRejectedValueOnce(new MetadataError(409, 'STALE_ATTEMPT', 'superseded'));
    const { report, at } = setup(send);
    report(10);
    await flush();
    at(3000);
    report(20);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
