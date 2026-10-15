import { retryAfterOf } from '../../../shared/api/http';
import { useAppSelector } from '../../../shared/lib/redux';
import { assetsApi, useListAssetsInfiniteQuery } from '../api/assets-api';
import { type AssetFilters, isActiveJobStatus } from './types';

/** Every poll refetches every loaded page, so this is slower than the 1 s on /jobs. */
export const LIVE_POLL_MS = 3000;

/**
 * Polls while a loaded file is still being processed, or while a job of this tab's uploads
 * (`awaitedJobIds`) has not shown up in the list; otherwise not at all. After a 429/503 it
 * waits as long as the gateway asked.
 */
export function useLiveAssets(
  filters: AssetFilters,
  { awaitedJobIds }: { awaitedJobIds: readonly string[] },
) {
  const cached = useAppSelector(assetsApi.endpoints.listAssets.select(filters));
  const items = cached.data?.pages.flatMap((page) => page.items) ?? [];
  const hasActive = items.some(
    (asset) => asset.latestJob !== null && isActiveJobStatus(asset.latestJob.status),
  );
  const listed = new Set(items.flatMap((asset) => (asset.latestJob ? [asset.latestJob.id] : [])));
  const awaiting = awaitedJobIds.some((id) => !listed.has(id));
  const retryAfterS = retryAfterOf(cached.error);
  const pollingInterval =
    retryAfterS !== null
      ? Math.max(retryAfterS * 1000, LIVE_POLL_MS)
      : hasActive || awaiting
        ? LIVE_POLL_MS
        : 0;
  return useListAssetsInfiniteQuery(filters, { pollingInterval, skipPollingIfUnfocused: true });
}
