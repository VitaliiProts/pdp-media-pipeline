import { useAppSelector } from '../../../shared/lib/redux';
import { jobsApi, type ListJobsArgs, useListJobsQuery } from '../api/jobs-api';
import { isTerminal } from './types';

const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

/**
 * Polls fast while something is still moving and slows down once everything
 * settled. The interval is decided from the cached result of the previous poll.
 */
export function useLiveJobs(
  args: ListJobsArgs,
  { hasLocalActivity }: { hasLocalActivity: boolean },
) {
  const cached = useAppSelector(jobsApi.endpoints.listJobs.select(args));
  const hasActiveJobs = cached.data?.items.some((job) => !isTerminal(job.status)) ?? false;
  const pollingInterval = hasActiveJobs || hasLocalActivity ? ACTIVE_POLL_MS : IDLE_POLL_MS;

  return useListJobsQuery(args, { pollingInterval, skipPollingIfUnfocused: true });
}
