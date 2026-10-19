import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useLiveAssets } from '../../features/assets';
import { selectUploads, uploadsListed, useOpenUpload } from '../../features/upload';
import { retryAfterOf } from '../../shared/api/http';
import { useAppDispatch, useAppSelector } from '../../shared/lib/redux';
import { Button } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { VisuallyHidden } from '../../shared/ui/visually-hidden/VisuallyHidden';
import styles from './LibraryPage.module.css';
import { useLibraryParams } from './lib/use-library-params';
import { useNextPageA11y } from './lib/use-next-page-a11y';
import { hasFilters } from './model/filters';
import { awaitedJobIds, newlyListedJobIds, pendingUploads } from './model/pending-uploads';
import { AssetTile } from './ui/AssetTile';
import { LibraryFilters } from './ui/LibraryFilters';
import { LoadMore } from './ui/LoadMore';
import { UploadTile } from './ui/UploadTile';

const SKELETON_TILES = 8;

export function LibraryPage() {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const { search } = useLocation();
  const openUpload = useOpenUpload();
  const [filters, setFilters] = useLibraryParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const isFiltered = hasFilters(filters);
  const dispatch = useAppDispatch();
  const uploads = useAppSelector(selectUploads);
  // Local tiles only without filters: whether a file will match them is not known yet.
  const awaited = useMemo(() => (isFiltered ? [] : awaitedJobIds(uploads)), [isFiltered, uploads]);
  const assets = useLiveAssets(filters, { awaitedJobIds: awaited });
  // `currentData`, not `data`: after a filter change the old results must not stand in for the new.
  const pages = assets.currentData?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const pending = useMemo(
    () => (isFiltered ? [] : pendingUploads(uploads, items)),
    [isFiltered, uploads, items],
  );
  const newlyListed = useMemo(() => newlyListedJobIds(uploads, items), [uploads, items]);
  useEffect(() => {
    if (newlyListed.length > 0) dispatch(uploadsListed(newlyListed));
  }, [newlyListed, dispatch]);
  const linkState = useMemo(() => ({ librarySearch: search }), [search]);

  const gridRef = useRef<HTMLUListElement>(null);
  const { announcement, loadMore } = useNextPageA11y({
    filtersKey: JSON.stringify([filters.kind, filters.status, filters.q]),
    pages,
    fetchNextPage: assets.fetchNextPage,
    gridRef,
    fallbackRef: searchRef,
  });

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
    if (items.length === 0 && pending.length === 0) {
      return isFiltered ? (
        <EmptyState
          title={t('library.noMatchesTitle')}
          action={
            <Button
              onClick={() => {
                setFilters({ kind: null, status: null, q: '', dubbed: false });
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
          {pending.map((upload) => (
            <li key={upload.id}>
              <UploadTile upload={upload} fallbackFocusRef={searchRef} />
            </li>
          ))}
          {items.map((asset) => (
            <li key={asset.id} data-asset-id={asset.id}>
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
        <span key={announcement.key}>{announcement.message}</span>
      </VisuallyHidden>
    </div>
  );
}
