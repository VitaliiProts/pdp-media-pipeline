import { useAppSelector } from '../../../shared/lib/redux';
import { assetsApi, useGetAssetQuery } from '../api/assets-api';
import { isActiveJobStatus } from './types';
import { LIVE_POLL_MS } from './use-live-assets';

/**
 * Polls while a job on the file is still going. Refetches on focus too: the presigned
 * URLs on the page expire after an hour.
 */
export function useLiveAsset(id: string) {
  const cached = useAppSelector(assetsApi.endpoints.getAsset.select(id));
  const hasActive = cached.data?.jobs.some((job) => isActiveJobStatus(job.status)) ?? false;
  return useGetAssetQuery(id, {
    pollingInterval: hasActive ? LIVE_POLL_MS : 0,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
}
