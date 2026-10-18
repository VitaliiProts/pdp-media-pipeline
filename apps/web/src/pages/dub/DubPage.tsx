import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { type AssetDetails, type AssetJob, useLiveAsset } from '../../features/assets';
import { httpStatusOf, retryAfterOf } from '../../shared/api/http';
import { languageName } from '../../shared/lib/language-name';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { requestOf, stageOf } from './model/dub-job';
import { DubFailure } from './ui/DubFailure';
import styles from './ui/DubPage.module.css';
import { DubProgress } from './ui/DubProgress';
import { DubResult } from './ui/DubResult';

/** A malformed id is refused with 400 before the lookup; for the user both mean "no such file". */
const MISSING = [400, 404];

/**
 * One dub of a library video: its steps while it runs, the result once done. The state lives
 * on the server, so a reload or a link from the library comes back to the same place.
 */
export function DubPage() {
  const { t } = useTranslation('dub');
  const { t: tShell } = useTranslation('shell');
  const { assetId = '', jobId = '' } = useParams();
  const asset = useLiveAsset(assetId);
  const status = asset.isError ? httpStatusOf(asset.error) : null;
  const isMissing = status !== null && MISSING.includes(status);
  const job = asset.data?.jobs.find((j) => j.id === jobId && j.type === 'video.dub');

  if (asset.data && !isMissing && job) return <DubView asset={asset.data} job={job} />;
  if ((asset.data && !job) || isMissing) {
    return (
      <div className={styles.page}>
        <PageHeading>{t('title')}</PageHeading>
        <EmptyState
          title={t('notFoundTitle')}
          action={
            <Link to={isMissing ? '/library' : `/library/${assetId}`} className={buttonClass()}>
              {t(isMissing ? 'toLibrary' : 'toFile')}
            </Link>
          }
        >
          <p>{t('notFoundBody')}</p>
        </EmptyState>
      </div>
    );
  }
  if (asset.isError) {
    const retryAfterS = retryAfterOf(asset.error);
    return (
      <div className={styles.page}>
        <PageHeading>{t('title')}</PageHeading>
        <ErrorState
          title={t('errorTitle')}
          retry={{ label: tShell('retry'), onRetry: () => void asset.refetch() }}
        >
          <p>{retryAfterS === null ? t('error') : t('tooManyRequests', { count: retryAfterS })}</p>
        </ErrorState>
      </div>
    );
  }
  return (
    <div role="status" aria-busy="true" aria-label={t('loading')} className={styles.page}>
      <Skeleton height="2.5rem" width="20rem" />
      <Skeleton height="24rem" radius="mount" />
    </div>
  );
}

function DubView({ asset, job }: { asset: AssetDetails; job: AssetJob }) {
  const { t, i18n } = useTranslation('dub');
  const { t: tAssets } = useTranslation('assets');
  const name = asset.name ?? tAssets('tile.untitled');
  const request = requestOf(job);
  const stage = stageOf(job);
  const language = languageName(request.targetLanguage, i18n.language);

  return (
    <div className={styles.page}>
      <nav aria-label={tAssets('asset.breadcrumbs')}>
        <ol className={styles.crumbs}>
          <li>
            <Link to="/library">{tAssets('library.title')}</Link>
          </li>
          <li>
            <Link to={`/library/${asset.id}`}>{name}</Link>
          </li>
          <li aria-current="page">{language}</li>
        </ol>
      </nav>
      <PageHeading>{t('heading', { name, language })}</PageHeading>
      {stage.kind === 'done' ? (
        <DubResult asset={asset} name={name} dub={stage.dub} request={request} />
      ) : stage.kind === 'failed' ? (
        <DubFailure
          failure={stage.failure}
          lastError={job.lastError}
          request={request}
          file={{ assetId: asset.id, sourceKey: asset.sourceKey }}
        />
      ) : (
        <DubProgress stage={stage} />
      )}
    </div>
  );
}
