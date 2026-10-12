import { useAppSelector } from '../../../shared/lib/redux';
import { useListDeliveriesQuery, webhooksApi } from '../api/webhooks-api';
import { isSettled } from './types';

const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 10_000;

/** Polls fast while a delivery is still being attempted, and honours `Retry-After`. */
export function useLiveDeliveries(endpointId: string) {
  const cached = useAppSelector(webhooksApi.endpoints.listDeliveries.select(endpointId));
  const isMoving = cached.data?.items.some((d) => !isSettled(d.status)) ?? false;
  const error = cached.error;
  const retryAfterS =
    error && 'kind' in error && error.kind === 'retryLater' ? error.retryAfterS : null;
  const pollingInterval =
    retryAfterS !== null
      ? Math.max(retryAfterS * 1000, ACTIVE_POLL_MS)
      : isMoving
        ? ACTIVE_POLL_MS
        : IDLE_POLL_MS;

  return useListDeliveriesQuery(endpointId, { pollingInterval, skipPollingIfUnfocused: true });
}
