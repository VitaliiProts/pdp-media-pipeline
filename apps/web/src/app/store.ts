import { combineSlices, configureStore, createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import { authApi, signedOut } from '../features/auth';
import { clearUploads, uploadsSlice } from '../features/upload';
import { baseApi } from '../shared/api/base-api';
import { configureHttp } from '../shared/api/http';
import { type ThunkExtra } from '../shared/lib/redux';

const rootReducer = combineSlices(uploadsSlice, baseApi);
export type RootState = ReturnType<typeof rootReducer>;

const AUTH_PATH = '/v1/auth/';

export function createStore() {
  const listener = createListenerMiddleware<RootState>();
  let session = new AbortController();
  const extra: ThunkExtra = { sessionSignal: () => session.signal };

  // A new identity, or none: the previous one's uploads and cached data must not leak into it.
  listener.startListening({
    matcher: isAnyOf(
      signedOut,
      authApi.endpoints.login.matchFulfilled,
      authApi.endpoints.register.matchFulfilled,
    ),
    effect: (_action, api) => {
      session.abort();
      session = new AbortController();
      api.dispatch(clearUploads());
      api.dispatch(baseApi.util.resetApiState());
    },
  });

  const store = configureStore({
    reducer: rootReducer,
    // The action log would keep a created API key, which arrives in a fulfilled payload.
    devTools: import.meta.env.DEV,
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: extra } })
        .prepend(listener.middleware)
        .concat(baseApi.middleware),
  });

  configureHttp({
    onUnauthorized: (url) => {
      // A session that expired mid-work: the shell re-checks and sends the user to sign in.
      if (!url.startsWith(AUTH_PATH)) store.dispatch(baseApi.util.invalidateTags(['Me']));
    },
  });

  return store;
}

export type AppStore = ReturnType<typeof createStore>;
