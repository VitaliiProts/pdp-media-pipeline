import { type AssetFilters } from '../../../features/assets';

/** Like the gateway, a blank search filters nothing. */
export const hasFilters = ({ kind, status, q, dubbed }: AssetFilters): boolean =>
  kind !== null || status !== null || q.trim() !== '' || dubbed;
