import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { FILTERABLE_STATUSES, type JobStatusFilter } from '../../../features/jobs';

const PARAM = 'status';

/** Keeps the status filter in the URL, so a filtered view survives reload and can be shared. */
export function useStatusParam(): [JobStatusFilter | null, (next: JobStatusFilter | null) => void] {
  const [params, setParams] = useSearchParams();
  const status = FILTERABLE_STATUSES.find((value) => value === params.get(PARAM)) ?? null;

  const update = useCallback(
    (next: JobStatusFilter | null) =>
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          if (next) copy.set(PARAM, next);
          else copy.delete(PARAM);
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );

  return [status, update];
}
