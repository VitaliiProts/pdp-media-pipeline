import { retryAfterOf } from '../../../shared/api/http';
import { useAppSelector } from '../../../shared/lib/redux';
import { assetsApi, useGetAssetQuery } from '../api/assets-api';
import { isActiveJobStatus } from './types';
import { LIVE_POLL_MS } from './use-live-assets';

/**
 * Polls while a job on the file is still going; after a 429/503 it waits as long as the
 * gateway asked. Refetches on focus too: the presigned URLs on the page expire after an hour.
 */
export function useLiveAsset(id: string) {
  const cached = useAppSelector(assetsApi.endpoints.getAsset.select(id));
  const hasActive = cached.data?.jobs.some((job) => isActiveJobStatus(job.status)) ?? false;
  const retryAfterS = retryAfterOf(cached.error);
  const pollingInterval =
    retryAfterS !== null
      ? Math.max(retryAfterS * 1000, LIVE_POLL_MS)
      : hasActive
        ? LIVE_POLL_MS
        : 0;
  return useGetAssetQuery(id, {
    pollingInterval,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
}
