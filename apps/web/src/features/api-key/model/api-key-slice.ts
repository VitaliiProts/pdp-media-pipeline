import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export const API_KEY_STORAGE_KEY = 'pdp.apiKey';

export type ApiKeyState = {
  key: string | null;
  /** Set when the gateway rejected the stored key, so the form can say why it is back. */
  wasRejected: boolean;
};

export function loadApiKeyState(storage: Pick<Storage, 'getItem'>): ApiKeyState {
  return { key: storage.getItem(API_KEY_STORAGE_KEY), wasRejected: false };
}

const initialState: ApiKeyState = { key: null, wasRejected: false };

export const apiKeySlice = createSlice({
  name: 'apiKey',
  initialState,
  reducers: {
    apiKeySaved(state, action: PayloadAction<string>) {
      state.key = action.payload.trim();
      state.wasRejected = false;
    },
    apiKeyRejected(state) {
      state.key = null;
      state.wasRejected = true;
    },
    apiKeyCleared(state) {
      state.key = null;
      state.wasRejected = false;
    },
  },
  selectors: {
    selectApiKey: (state) => state.key,
    selectApiKeyWasRejected: (state) => state.wasRejected,
  },
});

export const { apiKeySaved, apiKeyRejected, apiKeyCleared } = apiKeySlice.actions;
export const { selectApiKey, selectApiKeyWasRejected } = apiKeySlice.selectors;
