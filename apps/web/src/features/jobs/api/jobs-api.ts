import { baseApi } from '../../../shared/api/base-api';
import { type Job, type JobPage, type JobStatusFilter } from '../model/types';

export const JOBS_PAGE_SIZE = 48;

export type ListJobsArgs = { status: JobStatusFilter | null };

export const jobsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listJobs: build.query<JobPage, ListJobsArgs>({
      query: ({ status }) => ({
        url: '/v1/jobs',
        params: { limit: JOBS_PAGE_SIZE, ...(status ? { status } : {}) },
      }),
      providesTags: ['Job'],
    }),
    /** Sends a dead job through the pipeline again. */
    redriveJob: build.mutation<Job, string>({
      query: (id) => ({ url: `/v1/jobs/${encodeURIComponent(id)}/redrive`, method: 'POST' }),
      invalidatesTags: ['Job'],
    }),
  }),
});

export const { useListJobsQuery, useRedriveJobMutation } = jobsApi;
