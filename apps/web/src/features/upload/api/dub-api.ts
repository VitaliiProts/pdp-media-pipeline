import { baseApi } from '../../../shared/api/base-api';
import { type DubQuota, type StartDubArgs } from '../model/dub';

export const dubApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getDubQuota: build.query<DubQuota, void>({
      query: () => ({ url: '/v1/dub-quota' }),
      providesTags: ['DubQuota'],
    }),
    startDub: build.mutation<{ jobId: string }, StartDubArgs>({
      query: ({ sourceKey, targetLanguage, sourceLanguage, speakers, reuseOf }) => ({
        url: '/v1/jobs',
        method: 'POST',
        data: { type: 'video.dub', sourceKey, targetLanguage, sourceLanguage, speakers, reuseOf },
      }),
      invalidatesTags: (_result, error, { assetId }) =>
        error
          ? ['DubQuota']
          : ['DubQuota', 'Job', { type: 'Asset', id: assetId }, { type: 'Asset', id: 'LIST' }],
    }),
  }),
});

export const { useGetDubQuotaQuery, useStartDubMutation } = dubApi;
