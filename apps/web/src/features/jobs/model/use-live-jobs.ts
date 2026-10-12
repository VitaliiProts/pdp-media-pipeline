import { type SerializedError } from '@reduxjs/toolkit';
import { type AppError } from '../../../shared/api/http';
import { useAppSelector } from '../../../shared/lib/redux';
import { jobsApi, type ListJobsArgs, useListJobsQuery } from '../api/jobs-api';
import { isTerminal } from './types';

const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

/** Seconds the gateway asked to wait, if the last poll was refused for timing. */
export function retryAfterOf(error: AppError | SerializedError | undefined): number | null {
  return error && 'kind' in error && error.kind === 'retryLater' ? error.retryAfterS : null;
}

/**
 * Polls fast while something is still moving and slows down once everything
 * settled. The interval is decided from the cached result of the previous poll;
 * a refused poll waits as long as the gateway's `Retry-After` says.
 */
export function useLiveJobs(
  args: ListJobsArgs,
  { hasLocalActivity }: { hasLocalActivity: boolean },
) {
  const cached = useAppSelector(jobsApi.endpoints.listJobs.select(args));
  const hasActiveJobs = cached.data?.items.some((job) => !isTerminal(job.status)) ?? false;
  const retryAfterS = retryAfterOf(cached.error);
  const pollingInterval =
    retryAfterS !== null
      ? Math.max(retryAfterS * 1000, ACTIVE_POLL_MS)
      : hasActiveJobs || hasLocalActivity
        ? ACTIVE_POLL_MS
        : IDLE_POLL_MS;

  return useListJobsQuery(args, { pollingInterval, skipPollingIfUnfocused: true });
}
