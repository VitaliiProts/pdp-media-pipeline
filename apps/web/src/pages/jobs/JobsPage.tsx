import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusFilter, useLiveJobs } from '../../features/jobs';
import { dismissUpload, selectUploads, UploadPanel } from '../../features/upload';
import { retryAfterOf } from '../../shared/api/http';
import { useAppDispatch, useAppSelector } from '../../shared/lib/redux';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { VisuallyHidden } from '../../shared/ui/visually-hidden/VisuallyHidden';
import styles from './JobsPage.module.css';
import { useStatusParam } from './lib/use-status-param';
import { buildSheetItems } from './model/sheet-items';
import { ContactSheet } from './ui/ContactSheet';
import sheetStyles from './ui/ContactSheet.module.css';

const SKELETON_SLIDES = 6;

export function JobsPage() {
  const { t } = useTranslation('workspace');
  const dispatch = useAppDispatch();
  const [status, setStatus] = useStatusParam();
  const uploads = useAppSelector(selectUploads);
  const hasLocalActivity = uploads.some(
    (u) => u.phase === 'uploading' || u.phase === 'creating' || u.phase === 'waiting',
  );
  const jobs = useLiveJobs({ status }, { hasLocalActivity });

  const items = useMemo(
    () => buildSheetItems(jobs.data?.items ?? [], uploads),
    [jobs.data, uploads],
  );

  const handleDismiss = (uploadId: string) => {
    const upload = uploads.find((u) => u.id === uploadId);
    if (upload) dispatch(dismissUpload({ id: upload.id, previewUrl: upload.previewUrl }));
  };

  const renderSheet = () => {
    if (jobs.isLoading) {
      return (
        <div role="status" aria-busy="true">
          <VisuallyHidden>{t('sheet.loading')}</VisuallyHidden>
          <ol className={sheetStyles.sheet} aria-hidden="true">
            {Array.from({ length: SKELETON_SLIDES }, (_, index) => (
              <li key={index}>
                <Skeleton height="17rem" radius="mount" />
              </li>
            ))}
          </ol>
        </div>
      );
    }
    if (jobs.isError && items.length === 0) {
      const retryAfterS = retryAfterOf(jobs.error);
      return (
        <ErrorState
          title={t('sheet.errorTitle')}
          retry={{ label: t('sheet.retry'), onRetry: () => void jobs.refetch() }}
        >
          <p>
            {retryAfterS === null
              ? t('sheet.error')
              : t('sheet.tooManyRequests', { count: retryAfterS })}
          </p>
        </ErrorState>
      );
    }
    if (items.length === 0) {
      return status ? (
        <EmptyState title={t('sheet.emptyFiltered')} />
      ) : (
        <EmptyState title={t('sheet.empty')}>
          <p>{t('sheet.emptyBody')}</p>
        </EmptyState>
      );
    }
    return <ContactSheet items={items} onDismiss={handleDismiss} />;
  };

  return (
    <>
      <UploadPanel />
      <section className={styles.sheetSection} aria-label={t('sheet.title')}>
        <div className={styles.sheetHeader}>
          <PageHeading>{t('sheet.title')}</PageHeading>
          <StatusFilter value={status} onChange={setStatus} />
        </div>
        {renderSheet()}
      </section>
    </>
  );
}
