import { useMemo } from 'react';
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
import styles from './LibraryPage.module.css';
import { useLibraryParams } from './lib/use-library-params';
import { AssetTile } from './ui/AssetTile';
import { LibraryFilters } from './ui/LibraryFilters';

const SKELETON_TILES = 8;

export function LibraryPage() {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const { search } = useLocation();
  const openUpload = useOpenUpload();
  const [filters, setFilters] = useLibraryParams();
  const isFiltered = filters.kind !== null || filters.status !== null || filters.q !== '';
  const assets = useListAssetsInfiniteQuery(filters);
  // `currentData`, not `data`: after a filter change the old results must not stand in for the new.
  const pages = assets.currentData?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const linkState = useMemo(() => ({ librarySearch: search }), [search]);

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
            <Button onClick={() => setFilters({ kind: null, status: null, q: '' })}>
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
      <ul className={styles.grid}>
        {items.map((asset) => (
          <li key={asset.id}>
            <AssetTile asset={asset} linkState={linkState} />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div className={styles.page}>
      <PageHeading>{t('library.title')}</PageHeading>
      <LibraryFilters filters={filters} onChange={setFilters} />
      {content}
    </div>
  );
}
