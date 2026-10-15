import { AssetDeletedV1 } from '@pdp/contracts';
import {
  AssetPurgeHandler,
  type AssetPurgeDeps,
  PURGE_RETRY_DELAY_MS,
} from './asset-purge.handler';

const USER = '5b0c7c39-4b0d-4b47-9a52-1a0c1ab8e0a1';
const ASSET = '0f3e1a52-8f7d-4c0b-9e3b-6f4f1f5c2d11';
const KEY = `uploads/${USER}/clip.mp4`;

const event = (payload: Record<string, unknown> = {}) =>
  new TextEncoder().encode(
    JSON.stringify(
      AssetDeletedV1.parse({
        eventId: '7d1f6c2e-1b9a-4e55-8a0e-0d7f6a3b2c19',
        type: AssetDeletedV1.type,
        version: AssetDeletedV1.version,
        occurredAt: new Date().toISOString(),
        payload: { assetId: ASSET, userId: USER, key: KEY, reason: 'user', ...payload },
      }),
    ),
  );

function setup(pages: { ids: string[]; nextCursor: string | null }[]) {
  const deps = {
    listJobIds: jest.fn<
      ReturnType<AssetPurgeDeps['listJobIds']>,
      Parameters<AssetPurgeDeps['listJobIds']>
    >((_user, _asset, _limit, cursor) => Promise.resolve(pages[cursor ? Number(cursor) : 0]!)),
    deleteObject: jest.fn<Promise<void>, [string]>(() => Promise.resolve()),
    deletePrefix: jest.fn<Promise<number>, [string]>(() => Promise.resolve(3)),
  };
  return { deps, handler: new AssetPurgeHandler(deps) };
}

describe('AssetPurgeHandler', () => {
  it('deletes the results of every job, page by page, then the original', async () => {
    const { deps, handler } = setup([
      { ids: ['j1', 'j2'], nextCursor: '1' },
      { ids: ['j3'], nextCursor: null },
    ]);

    expect(await handler.handle(event())).toEqual({ kind: 'ack' });
    expect(deps.listJobIds.mock.calls.map(([, asset, , cursor]) => [asset, cursor])).toEqual([
      [ASSET, undefined],
      [ASSET, '1'],
    ]);
    expect(deps.deletePrefix.mock.calls.map(([prefix]) => prefix)).toEqual([
      'results/j1/',
      'results/j2/',
      'results/j3/',
    ]);
    expect(deps.deleteObject).toHaveBeenCalledWith(KEY);
  });

  it('deletes only the original of an upload no job used', async () => {
    const { deps, handler } = setup([{ ids: [], nextCursor: null }]);
    expect(await handler.handle(event({ reason: 'unused' }))).toEqual({ kind: 'ack' });
    expect(deps.deletePrefix).not.toHaveBeenCalled();
    expect(deps.deleteObject).toHaveBeenCalledWith(KEY);
  });

  it('retries later when storage fails, keeping the original for the next attempt', async () => {
    const { deps, handler } = setup([{ ids: ['j1'], nextCursor: null }]);
    deps.deletePrefix.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    expect(await handler.handle(event())).toEqual({ kind: 'nak', delayMs: PURGE_RETRY_DELAY_MS });
    expect(deps.deleteObject).not.toHaveBeenCalled();
  });

  it('terminates an event it cannot parse', async () => {
    const { handler } = setup([]);
    const result = await handler.handle(new TextEncoder().encode('{"type":"asset.deleted"}'));
    expect(result.kind).toBe('term');
  });
});
