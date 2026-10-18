import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { ASSET_KINDS, ASSET_STATUSES, type AssetFilters } from '../../../features/assets';

export type FilterPatch = Partial<AssetFilters>;
export type SetFilters = (patch: FilterPatch, options?: { replace?: boolean }) => void;

/** Filters live in the URL, so they survive a reload and the back button; unknown values are ignored. */
export function useLibraryParams(): readonly [AssetFilters, SetFilters] {
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('kind');
  const statusParam = params.get('status');
  const q = params.get('q') ?? '';
  const dubbed = params.get('dubbed') === 'true';

  const filters = useMemo<AssetFilters>(
    () => ({
      kind: ASSET_KINDS.find((kind) => kind === kindParam) ?? null,
      status: ASSET_STATUSES.find((status) => status === statusParam) ?? null,
      q,
      dubbed,
    }),
    [kindParam, statusParam, q, dubbed],
  );

  const setFilters = useCallback<SetFilters>(
    (patch, { replace = false } = {}) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, String(value));
            else next.delete(key);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  return [filters, setFilters] as const;
}
