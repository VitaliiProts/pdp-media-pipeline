import { baseApi } from '../../../shared/api/base-api';
import { type ApiKey, type CreatedApiKey } from '../model/types';

export const apiKeysApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listApiKeys: build.query<{ items: ApiKey[] }, void>({
      query: () => ({ url: '/v1/api-keys' }),
      providesTags: ['ApiKey'],
    }),
    createApiKey: build.mutation<CreatedApiKey, { name: string }>({
      query: (body) => ({ url: '/v1/api-keys', method: 'POST', data: body }),
      invalidatesTags: ['ApiKey'],
    }),
    // A 404 means it is already gone; the list refetch shows that either way.
    revokeApiKey: build.mutation<void, string>({
      query: (id) => ({ url: `/v1/api-keys/${encodeURIComponent(id)}`, method: 'DELETE' }),
      invalidatesTags: ['ApiKey'],
    }),
  }),
});

export const { useListApiKeysQuery, useCreateApiKeyMutation, useRevokeApiKeyMutation } = apiKeysApi;
