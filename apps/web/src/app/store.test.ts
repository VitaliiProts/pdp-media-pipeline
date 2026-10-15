import { delay, http as mock, HttpResponse } from 'msw';
import { API_KEY_STORAGE_KEY, selectApiKey } from '../features/api-key';
import { http } from '../shared/api/http';
import { server } from '../test/server';
import { createStore } from './store';

const storageWith = (key: string) => {
  window.localStorage.setItem(API_KEY_STORAGE_KEY, key);
  return window.localStorage;
};

describe('rejected keys', () => {
  it('forgets the key the gateway rejected', async () => {
    server.use(mock.get('/v1/jobs', () => new HttpResponse(null, { status: 401 })));
    const store = createStore(storageWith('revoked'));

    await expect(http.get('/v1/jobs')).rejects.toThrow();
    expect(selectApiKey(store.getState())).toBeNull();
  });

  it('keeps a newer key when a late refusal for the old one arrives', async () => {
    let markSent: () => void = () => undefined;
    const sent = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    server.use(
      mock.get('/v1/jobs', async () => {
        markSent();
        await delay(50);
        return new HttpResponse(null, { status: 401 });
      }),
    );
    createStore(storageWith('old'));
    const stale = http.get('/v1/jobs');
    await sent;
    const store = createStore(storageWith('new'));

    await expect(stale).rejects.toThrow();
    expect(selectApiKey(store.getState())).toBe('new');
  });
});
