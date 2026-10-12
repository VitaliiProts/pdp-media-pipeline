import { useCallback, useState } from 'react';
import { FILTERABLE_STATUSES, type JobStatusFilter } from '../../../features/jobs';

const PARAM = 'status';

const parse = (value: string | null): JobStatusFilter | null =>
  FILTERABLE_STATUSES.find((status) => status === value) ?? null;

/** Keeps the status filter in the URL, so a filtered view survives reload and can be shared. */
export function useStatusParam(): [JobStatusFilter | null, (next: JobStatusFilter | null) => void] {
  const [status, setStatus] = useState(() =>
    parse(new URLSearchParams(window.location.search).get(PARAM)),
  );

  const update = useCallback((next: JobStatusFilter | null) => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(PARAM, next);
    else url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url);
    setStatus(next);
  }, []);

  return [status, update];
}
