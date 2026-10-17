import { waitFor } from '@testing-library/react';
import { http as mock, HttpResponse } from 'msw';
import { authApi, signedOut } from '../features/auth';
import { http } from '../shared/api/http';
import { type ThunkExtra } from '../shared/lib/redux';
import { TEST_ME } from '../test/fixtures';
import { server } from '../test/server';
import { createStore } from './store';

const currentSignal = (store: ReturnType<typeof createStore>) =>
  store.dispatch((_dispatch: unknown, _getState: unknown, extra: ThunkExtra) =>
    extra.sessionSignal(),
  );

describe('session', () => {
  it('stops the work of a session that ends', () => {
    const store = createStore();
    const before = currentSignal(store);

    store.dispatch(signedOut());

    expect(before.aborted).toBe(true);
    expect(currentSignal(store).aborted).toBe(false);
  });

  it('re-checks who is signed in after a 401, but not after a wrong password', async () => {
    let meCalls = 0;
    server.use(
      mock.get('/v1/me', () => {
        meCalls += 1;
        return HttpResponse.json(TEST_ME);
      }),
      mock.post('/v1/auth/login', () => HttpResponse.json({ message: 'no' }, { status: 401 })),
      mock.get('/v1/jobs', () => new HttpResponse(null, { status: 401 })),
    );
    const store = createStore();
    await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(meCalls).toBe(1);

    await http.post('/v1/auth/login', {}).catch(() => undefined);
    await http.get('/v1/jobs').catch(() => undefined);

    await waitFor(() => expect(meCalls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(meCalls).toBe(2);
  });
});
