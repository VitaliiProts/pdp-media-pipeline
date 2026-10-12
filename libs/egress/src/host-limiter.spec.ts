import { HostConcurrencyLimiter } from './host-limiter';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('HostConcurrencyLimiter', () => {
  it('runs at most perHost tasks against one host at a time', async () => {
    const limiter = new HostConcurrencyLimiter(2);
    const gates = [deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;

    const runs = gates.map((gate) =>
      limiter.run('https://example.com/a.jpg', async () => {
        running++;
        peak = Math.max(peak, running);
        await gate.promise;
        running--;
      }),
    );
    await tick();
    expect(running).toBe(2);

    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it('does not let a slow host block another one', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const slow = deferred();
    const blocked = limiter.run('https://slow.example/x', () => slow.promise);

    await expect(limiter.run('https://fast.example/y', () => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
    slow.resolve();
    await blocked;
  });

  it('treats host names case-insensitively and forgets idle hosts', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const gate = deferred();
    const first = limiter.run('https://Example.com/a', () => gate.promise);
    const second = limiter.run('https://example.COM/b', () => Promise.resolve());
    await tick();
    expect(limiter.trackedHosts).toBe(1);

    gate.resolve();
    await Promise.all([first, second]);
    expect(limiter.trackedHosts).toBe(0);
  });

  it('releases the slot when the task fails', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    await expect(
      limiter.run('https://example.com', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(limiter.run('https://example.com', () => Promise.resolve(1))).resolves.toBe(1);
  });
});
