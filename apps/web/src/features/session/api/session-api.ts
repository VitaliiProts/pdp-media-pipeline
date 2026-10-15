import { baseApi } from '../../../shared/api/base-api';
import { type Me } from '../model/types';

export const sessionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Errors provide no tag: invalidating `Me` after a 401 must not refetch it in a loop.
    getMe: build.query<Me, void>({
      query: () => ({ url: '/v1/me' }),
      providesTags: (result) => (result ? ['Me'] : []),
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/v1/auth/logout', method: 'POST' }),
    }),
  }),
});

export const { useGetMeQuery, useLogoutMutation } = sessionApi;
