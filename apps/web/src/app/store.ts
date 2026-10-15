import { combineSlices, configureStore, createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import {
  API_KEY_STORAGE_KEY,
  apiKeyCleared,
  apiKeyRejected,
  apiKeySaved,
  apiKeySlice,
  loadApiKeyState,
  selectApiKey,
} from '../features/api-key';
import { clearUploads, uploadsSlice } from '../features/upload';
import { baseApi } from '../shared/api/base-api';
import { configureHttp } from '../shared/api/http';
import { type ThunkExtra } from '../shared/lib/redux';

const rootReducer = combineSlices(apiKeySlice, uploadsSlice, baseApi);
export type RootState = ReturnType<typeof rootReducer>;

export function createStore(storage: Storage = window.localStorage) {
  const listener = createListenerMiddleware<RootState>();
  let session = new AbortController();
  const extra: ThunkExtra = { sessionSignal: () => session.signal };

  listener.startListening({
    actionCreator: apiKeyCleared,
    effect: (_action, api) => {
      session.abort();
      session = new AbortController();
      // The next user must not see, or be alerted about, the previous user's files.
      api.dispatch(clearUploads());
    },
  });

  listener.startListening({
    matcher: isAnyOf(apiKeySaved, apiKeyRejected, apiKeyCleared),
    effect: (_action, api) => {
      const key = selectApiKey(api.getState());
      if (key) storage.setItem(API_KEY_STORAGE_KEY, key);
      else storage.removeItem(API_KEY_STORAGE_KEY);
      // Cached jobs belong to the previous key.
      api.dispatch(baseApi.util.resetApiState());
    },
  });

  const store = configureStore({
    reducer: rootReducer,
    preloadedState: { apiKey: loadApiKeyState(storage) },
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: extra } })
        .prepend(listener.middleware)
        .concat(baseApi.middleware),
  });

  configureHttp({
    getApiKey: () => selectApiKey(store.getState()),
    onUnauthorized: (sentKey) => {
      // A late 401 for a key that has since been replaced says nothing about the current one.
      if (sentKey !== null && sentKey === selectApiKey(store.getState())) {
        store.dispatch(apiKeyRejected());
      }
      // A session that expired mid-work: the shell re-checks and sends the user to sign in.
      store.dispatch(baseApi.util.invalidateTags(['Me']));
    },
  });

  return store;
}

export type AppStore = ReturnType<typeof createStore>;
