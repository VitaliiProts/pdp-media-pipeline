import { type BaseQueryFn, createApi } from '@reduxjs/toolkit/query/react';
import { type AxiosRequestConfig } from 'axios';
import { type AppError, http, toAppError } from './http';

type HttpArgs = Pick<AxiosRequestConfig, 'url' | 'method' | 'data' | 'params'>;

const axiosBaseQuery: BaseQueryFn<HttpArgs, unknown, AppError> = async (args, { signal }) => {
  try {
    const { data } = await http.request<unknown>({ ...args, signal });
    return { data };
  } catch (error) {
    return { error: toAppError(error) };
  }
};

/** Features add their endpoints with `injectEndpoints`; tags let them invalidate each other. */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery,
  tagTypes: ['Job', 'Webhook', 'Me'],
  endpoints: () => ({}),
});
