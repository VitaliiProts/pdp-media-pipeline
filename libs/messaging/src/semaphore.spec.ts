import { Semaphore } from './semaphore';

const tick = () => new Promise((r) => setImmediate(r));

describe('Semaphore', () => {
  it('caps concurrent holders', async () => {
    const semaphore = new Semaphore(2);
    await semaphore.acquire();
    await semaphore.acquire();
    let third = false;
    void semaphore.acquire().then(() => (third = true));
    await tick();
    expect(third).toBe(false);
    expect(semaphore.waiting).toBe(1);

    semaphore.release();
    await tick();
    expect(third).toBe(true);
    expect(semaphore.active).toBe(2);
  });

  it('hands a released slot to the longest waiter, not to whoever asks next', async () => {
    // Two pull loops sharing one slot: the one that releases must not take it straight back.
    const semaphore = new Semaphore(1);
    const turns: string[] = [];
    let running = true;
    const loop = async (name: string) => {
      while (running) {
        await semaphore.acquire();
        turns.push(name);
        await tick();
        semaphore.release();
      }
    };
    const loops = [loop('priority'), loop('cpu')];
    while (turns.length < 6) await tick();
    running = false;
    await Promise.all(loops);

    expect(turns.slice(0, 6)).toEqual(['priority', 'cpu', 'priority', 'cpu', 'priority', 'cpu']);
  });

  it('rejects releasing more than was acquired', () => {
    expect(() => new Semaphore(1).release()).toThrow();
  });
});
