import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useListAssetsInfiniteQuery } from '../../features/assets';
import { useOpenUpload } from '../../features/upload';
import { retryAfterOf } from '../../shared/api/http';
import { Button } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { VisuallyHidden } from '../../shared/ui/visually-hidden/VisuallyHidden';
import styles from './LibraryPage.module.css';
import { useLibraryParams } from './lib/use-library-params';
import { AssetTile } from './ui/AssetTile';
import { LibraryFilters } from './ui/LibraryFilters';
import { LoadMore, type LoadTrigger } from './ui/LoadMore';

const SKELETON_TILES = 8;

export function LibraryPage() {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const { search } = useLocation();
  const openUpload = useOpenUpload();
  const [filters, setFilters] = useLibraryParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const isFiltered = filters.kind !== null || filters.status !== null || filters.q !== '';
  const assets = useListAssetsInfiniteQuery(filters);
  // `currentData`, not `data`: after a filter change the old results must not stand in for the new.
  const pages = assets.currentData?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const linkState = useMemo(() => ({ librarySearch: search }), [search]);

  const filtersKey = JSON.stringify([filters.kind, filters.status, filters.q]);
  const pageCount = pages?.length ?? 0;
  const lastPageStart = items.length - (pages?.at(-1)?.items.length ?? 0);
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

  const gridRef = useRef<HTMLUListElement>(null);
  /** Set by a press of the button: the first file of the page it asked for takes focus. */
  const focusNextPage = useRef<{ filtersKey: string; pageCount: number } | null>(null);
  const { fetchNextPage } = assets;
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
    gridRef.current?.children.item(lastPageStart)?.querySelector('a')?.focus();
  }, [filtersKey, pageCount, lastPageStart]);

  const content = (() => {
    if (!pages) {
      if (assets.isError) {
        const retryAfterS = retryAfterOf(assets.error);
        return (
          <ErrorState
            title={t('library.errorTitle')}
            retry={{ label: tShell('retry'), onRetry: () => void assets.refetch() }}
          >
            <p>
              {retryAfterS === null
                ? t('library.error')
                : t('library.tooManyRequests', { count: retryAfterS })}
            </p>
          </ErrorState>
        );
      }
      return (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('library.loading')}
          className={styles.grid}
        >
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <Skeleton key={index} height="14rem" radius="mount" />
          ))}
        </div>
      );
    }
    if (items.length === 0) {
      return isFiltered ? (
        <EmptyState
          title={t('library.noMatchesTitle')}
          action={
            <Button
              onClick={() => {
                setFilters({ kind: null, status: null, q: '' });
                // The button leaves with its empty state; the cleared search is where to carry on.
                searchRef.current?.focus();
              }}
            >
              {t('library.resetFilters')}
            </Button>
          }
        >
          <p>{t('library.noMatchesBody')}</p>
        </EmptyState>
      ) : (
        <EmptyState
          title={t('library.emptyTitle')}
          action={
            <Button variant="primary" onClick={openUpload}>
              {t('library.upload')}
            </Button>
          }
        >
          <p>{t('library.emptyBody')}</p>
        </EmptyState>
      );
    }
    return (
      <>
        <ul ref={gridRef} className={styles.grid}>
          {items.map((asset) => (
            <li key={asset.id}>
              <AssetTile asset={asset} linkState={linkState} />
            </li>
          ))}
        </ul>
        {assets.hasNextPage && (
          <LoadMore
            isLoading={assets.isFetchingNextPage}
            failed={assets.isFetchNextPageError}
            onLoad={loadMore}
          />
        )}
      </>
    );
  })();

  return (
    <div className={styles.page}>
      <PageHeading>{t('library.title')}</PageHeading>
      <LibraryFilters filters={filters} onChange={setFilters} searchRef={searchRef} />
      {content}
      <VisuallyHidden aria-live="polite">
        {/* A new node per page: the same text twice in a row would not be read again. */}
        <span key={announced.pageCount}>{announced.message}</span>
      </VisuallyHidden>
    </div>
  );
}
