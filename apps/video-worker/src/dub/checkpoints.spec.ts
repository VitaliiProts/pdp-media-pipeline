import { z } from 'zod';
import { DubCheckpoints, type DubStorage } from './checkpoints';

function memoryStorage(objects = new Map<string, Buffer>()) {
  const storage: DubStorage = {
    exists: (key) => Promise.resolve(objects.has(key)),
    getObject: (key) => Promise.resolve(objects.get(key)!),
    putObject: (key, body) => Promise.resolve(void objects.set(key, body)),
    downloadToFile: () => Promise.reject(new Error('unused')),
    uploadFile: () => Promise.reject(new Error('unused')),
    copyObject: (source, target) => Promise.resolve(void objects.set(target, objects.get(source)!)),
  };
  return { objects, storage };
}

const Count = z.object({ count: z.number() });

describe('DubCheckpoints', () => {
  it('computes once and reads the stored value afterwards', async () => {
    const { objects, storage } = memoryStorage();
    const compute = jest.fn(() => Promise.resolve({ count: 1 }));
    const checkpoints = new DubCheckpoints(storage, 'j1');

    await expect(checkpoints.json('n.json', Count, compute)).resolves.toEqual({ count: 1 });
    await expect(checkpoints.json('n.json', Count, compute)).resolves.toEqual({ count: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(objects.has('results/j1/dub/n.json')).toBe(true);
  });

  it('computes again over a value an older worker stored in another shape', async () => {
    const { objects, storage } = memoryStorage();
    objects.set('results/j1/dub/n.json', Buffer.from('{"total":3}'));

    const value = await new DubCheckpoints(storage, 'j1').json('n.json', Count, () =>
      Promise.resolve({ count: 2 }),
    );
    expect(value).toEqual({ count: 2 });
    expect(JSON.parse(objects.get('results/j1/dub/n.json')!.toString())).toEqual({ count: 2 });
  });

  it('copies from another job only what this job lacks and the other has', async () => {
    const { objects, storage } = memoryStorage();
    objects.set('results/old/dub/a.json', Buffer.from('old a'));
    objects.set('results/old/dub/b.json', Buffer.from('old b'));
    objects.set('results/new/dub/b.json', Buffer.from('own b'));

    await new DubCheckpoints(storage, 'new').copyFrom('old', ['a.json', 'b.json', 'c.json']);
    expect(objects.get('results/new/dub/a.json')?.toString()).toBe('old a');
    expect(objects.get('results/new/dub/b.json')?.toString()).toBe('own b');
    expect(objects.has('results/new/dub/c.json')).toBe(false);
  });
});
