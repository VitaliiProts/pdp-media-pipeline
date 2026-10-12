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
import { uploadsSlice } from '../features/upload';
import { baseApi } from '../shared/api/base-api';
import { configureHttp } from '../shared/api/http';

const rootReducer = combineSlices(apiKeySlice, uploadsSlice, baseApi);
export type RootState = ReturnType<typeof rootReducer>;

export function createStore(storage: Storage = window.localStorage) {
  const listener = createListenerMiddleware<RootState>();

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
      getDefault().prepend(listener.middleware).concat(baseApi.middleware),
  });

  configureHttp({
    getApiKey: () => selectApiKey(store.getState()),
    onUnauthorized: () => {
      if (selectApiKey(store.getState())) store.dispatch(apiKeyRejected());
    },
  });

  return store;
}

export type AppStore = ReturnType<typeof createStore>;
