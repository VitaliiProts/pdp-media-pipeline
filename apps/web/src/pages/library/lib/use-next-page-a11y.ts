import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetPage } from '../../../features/assets';

/** What asked for the next page: a press moves focus on to it, scrolling does not. */
export type LoadTrigger = 'button' | 'scroll';

type NextPageA11yOptions = {
  /** Identifies the filters the pages belong to. */
  filtersKey: string;
  pages: readonly AssetPage[] | undefined;
  fetchNextPage: () => unknown;
  /** Holds the tiles, each marked with `data-asset-id`. */
  gridRef: RefObject<HTMLElement | null>;
  /** Takes focus when a pressed load brings no tile to move on to and the button went away. */
  fallbackRef: RefObject<HTMLElement | null>;
};

/**
 * Says how many files each new page added, and after a press of "Show more"
 * moves focus to the first file it brought.
 */
export function useNextPageA11y({
  filtersKey,
  pages,
  fetchNextPage,
  gridRef,
  fallbackRef,
}: NextPageA11yOptions) {
  const { t } = useTranslation('assets');
  const pageCount = pages?.length ?? 0;
  const newestPageFirstId = pages?.at(-1)?.items[0]?.id;

  const [announced, setAnnounced] = useState({ filtersKey, pageCount, message: '' });
  // Other filters start over, even when their pages come straight from the cache. Within the
  // same filters a new page says how many files it added; polling refetches keep the count.
  if (filtersKey !== announced.filtersKey || pageCount !== announced.pageCount) {
    const isNextPage =
      filtersKey === announced.filtersKey &&
      announced.pageCount > 0 &&
      pageCount > announced.pageCount;
    const added = isNextPage ? (pages?.at(-1)?.items.length ?? 0) : 0;
    setAnnounced({
      filtersKey,
      pageCount,
      message: added > 0 ? t('library.more.added', { count: added }) : '',
    });
  }

  const focusNextPage = useRef<{ filtersKey: string; pageCount: number } | null>(null);
  const loadMore = useCallback(
    (trigger: LoadTrigger) => {
      if (trigger === 'button') focusNextPage.current = { filtersKey, pageCount };
      void fetchNextPage();
    },
    [fetchNextPage, filtersKey, pageCount],
  );

  useEffect(() => {
    const pending = focusNextPage.current;
    if (!pending) return;
    if (pending.filtersKey !== filtersKey) {
      focusNextPage.current = null;
      return;
    }
    if (pageCount <= pending.pageCount) return;
    focusNextPage.current = null;
    // By id, not position: the grid can hold tiles that are not from these pages.
    const tile = Array.from(gridRef.current?.querySelectorAll('[data-asset-id]') ?? []).find(
      (element) => element instanceof HTMLElement && element.dataset.assetId === newestPageFirstId,
    );
    const link = tile?.querySelector('a');
    if (link) link.focus();
    // An empty page that is not the last leaves the button, and the focus on it, in place.
    else if (document.activeElement === null || document.activeElement === document.body) {
      fallbackRef.current?.focus();
    }
  }, [filtersKey, pageCount, newestPageFirstId, gridRef, fallbackRef]);

  return {
    /** A new key per page: the same text twice in a row would not be read again. */
    announcement: { key: announced.pageCount, message: announced.message },
    loadMore,
  };
}
