import { useCallback, useState } from 'react';

export const VIEWS = ['jobs', 'webhooks'] as const;
export type View = (typeof VIEWS)[number];

const PARAM = 'view';

const parse = (value: string | null): View => VIEWS.find((view) => view === value) ?? 'jobs';

/** The app has two views and no router; the URL keeps the open one across reloads. */
export function useViewParam(): [View, (next: View) => void] {
  const [view, setView] = useState(() =>
    parse(new URLSearchParams(window.location.search).get(PARAM)),
  );

  const update = useCallback((next: View) => {
    const url = new URL(window.location.href);
    if (next === 'jobs') url.searchParams.delete(PARAM);
    else url.searchParams.set(PARAM, next);
    window.history.replaceState(null, '', url);
    setView(next);
  }, []);

  return [view, update];
}
