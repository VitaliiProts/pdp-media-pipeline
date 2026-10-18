import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  type AssetDetails,
  DeleteAssetButton,
  playableOf,
  useLiveAsset,
} from '../../features/assets';
import { TranslateDialog } from '../../features/upload';
import { httpStatusOf, retryAfterOf } from '../../shared/api/http';
import { formatBytes } from '../../shared/lib/format-bytes';
import { formatDuration } from '../../shared/lib/format-duration';
import { Button, buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { Tabs } from '../../shared/ui/tabs/Tabs';
import { useToast } from '../../shared/ui/toast/toast-context';
import { librarySearchOf } from './lib/library-search';
import { AssetJobs } from './ui/AssetJobs';
import styles from './ui/AssetPage.module.css';
import { VersionList } from './ui/VersionList';
import { VideoPlayer } from './ui/VideoPlayer';

/** A malformed id is refused with 400 before the lookup; for the user both mean "no such file". */
const MISSING = [400, 404];

export function AssetPage() {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const { assetId = '' } = useParams();
  const asset = useLiveAsset(assetId);
  const status = asset.isError ? httpStatusOf(asset.error) : null;
  // RTK keeps the last data after a failed refetch; a file deleted elsewhere must not linger.
  const isMissing = status !== null && MISSING.includes(status);

  if (asset.data && !isMissing) return <AssetView asset={asset.data} />;
  if (asset.isError) {
    const retryAfterS = retryAfterOf(asset.error);
    return (
      <div className={styles.page}>
        <PageHeading>{t('asset.title')}</PageHeading>
        {isMissing ? (
          <EmptyState
            title={t('asset.notFoundTitle')}
            action={
              <Link to="/library" className={buttonClass()}>
                {t('asset.toLibrary')}
              </Link>
            }
          >
            <p>{t('asset.notFoundBody')}</p>
          </EmptyState>
        ) : (
          <ErrorState
            title={t('asset.errorTitle')}
            retry={{ label: tShell('retry'), onRetry: () => void asset.refetch() }}
          >
            <p>
              {retryAfterS === null
                ? t('asset.error')
                : t('library.tooManyRequests', { count: retryAfterS })}
            </p>
          </ErrorState>
        )}
      </div>
    );
  }
  return (
    <div role="status" aria-busy="true" aria-label={t('asset.loading')} className={styles.page}>
      <Skeleton height="2.5rem" width="20rem" />
      <Skeleton height="24rem" radius="mount" />
    </div>
  );
}

function AssetView({ asset }: { asset: AssetDetails }) {
  const { t, i18n } = useTranslation('assets');
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const librarySearch = librarySearchOf(location.state);
  const name = asset.name ?? t('tile.untitled');
  const uploaded = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
        new Date(asset.createdAt),
      ),
    [i18n.language, asset.createdAt],
  );
  const { renditions, poster } = playableOf(asset.jobs);
  const [translating, setTranslating] = useState(false);
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  const handleDeleted = () => {
    toast({ tone: 'success', message: t('delete.done') });
    // A late answer must not replace wherever the user has gone since.
    if (isMounted.current) void navigate(`/library${librarySearch}`, { replace: true });
  };

  return (
    <div className={styles.page}>
      <nav aria-label={t('asset.breadcrumbs')}>
        <ol className={styles.crumbs}>
          <li>
            <Link to={`/library${librarySearch}`}>{t('library.title')}</Link>
          </li>
          <li aria-current="page">{name}</li>
        </ol>
      </nav>
      <div className={styles.header}>
        <PageHeading>{name}</PageHeading>
        <div className={styles.actions}>
          {asset.kind === 'video' && (
            <Button variant="primary" onClick={() => setTranslating(true)}>
              {t('asset.translate')}
            </Button>
          )}
          <a className={buttonClass()} href={asset.originalDownloadUrl} download>
            {t('asset.downloadOriginal')}
          </a>
          <DeleteAssetButton assetId={asset.id} name={name} onDeleted={handleDeleted} />
        </div>
      </div>
      <dl className={styles.facts}>
        {asset.width !== null && asset.height !== null && (
          <div>
            <dt>{t('asset.dimensions')}</dt>
            <dd>{t('asset.dimensionsValue', { width: asset.width, height: asset.height })}</dd>
          </div>
        )}
        {asset.durationSeconds !== null && (
          <div>
            <dt>{t('asset.duration')}</dt>
            <dd>{formatDuration(asset.durationSeconds)}</dd>
          </div>
        )}
        {asset.size !== null && (
          <div>
            <dt>{t('asset.size')}</dt>
            <dd>{formatBytes(asset.size, i18n.language)}</dd>
          </div>
        )}
        <div>
          <dt>{t('asset.type')}</dt>
          <dd>{asset.contentType}</dd>
        </div>
        <div>
          <dt>{t('asset.uploaded')}</dt>
          <dd>{uploaded}</dd>
        </div>
      </dl>
      {asset.kind === 'video' ? (
        <VideoPlayer
          name={name}
          originalUrl={asset.originalUrl}
          renditions={renditions}
          poster={poster}
        />
      ) : (
        <img
          className={styles.original}
          src={asset.originalUrl}
          width={asset.width ?? undefined}
          height={asset.height ?? undefined}
          alt={name}
        />
      )}
      <Tabs
        label={t('asset.tabs')}
        items={[
          { id: 'versions', label: t('versions.tab'), panel: <VersionList jobs={asset.jobs} /> },
          {
            id: 'jobs',
            label: t('jobs.tab'),
            panel: (
              <AssetJobs
                assetId={asset.id}
                jobs={asset.jobs}
                hasMore={asset.jobsNextCursor !== null}
              />
            ),
          },
        ]}
      />
      {asset.kind === 'video' && (
        <TranslateDialog
          open={translating}
          onClose={() => setTranslating(false)}
          file={{
            assetId: asset.id,
            sourceKey: asset.sourceKey,
            name,
            durationSeconds: asset.durationSeconds,
          }}
          onStarted={(jobId) => void navigate(`/library/${asset.id}/dubs/${jobId}`)}
        />
      )}
    </div>
  );
}
