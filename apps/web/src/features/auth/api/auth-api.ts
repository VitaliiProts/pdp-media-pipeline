import { baseApi } from '../../../shared/api/base-api';
import { type Credentials, type Me, type Registration } from '../model/types';

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Errors provide no tag: invalidating `Me` after a 401 must not refetch it in a loop.
    getMe: build.query<Me, void>({
      query: () => ({ url: '/v1/me' }),
      providesTags: (result) => (result ? ['Me'] : []),
    }),
    login: build.mutation<unknown, Credentials>({
      query: (body) => ({ url: '/v1/auth/login', method: 'POST', data: body }),
    }),
    register: build.mutation<unknown, Registration>({
      query: (body) => ({ url: '/v1/auth/register', method: 'POST', data: body }),
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/v1/auth/logout', method: 'POST' }),
    }),
  }),
});

export const { useGetMeQuery, useLoginMutation, useRegisterMutation, useLogoutMutation } = authApi;
