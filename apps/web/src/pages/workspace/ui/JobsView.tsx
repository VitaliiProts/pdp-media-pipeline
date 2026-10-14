import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusFilter, useLiveJobs } from '../../../features/jobs';
import { dismissUpload, selectUploads, UploadPanel } from '../../../features/upload';
import { retryAfterOf } from '../../../shared/api/http';
import { useAppDispatch, useAppSelector } from '../../../shared/lib/redux';
import { useStatusParam } from '../lib/use-status-param';
import { buildSheetItems } from '../model/sheet-items';
import { ContactSheet, SheetMessage } from './ContactSheet';
import styles from './JobsView.module.css';

export function JobsView() {
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

  const retryAfterS = retryAfterOf(jobs.error);

  const renderSheet = () => {
    if (jobs.isLoading) return <SheetMessage>{t('sheet.loading')}</SheetMessage>;
    if (jobs.isError && items.length === 0) {
      return (
        <SheetMessage tone="error">
          <p>
            {retryAfterS === null
              ? t('sheet.error')
              : t('sheet.tooManyRequests', { count: retryAfterS })}
          </p>
          <button type="button" className={styles.retry} onClick={() => void jobs.refetch()}>
            {t('sheet.retry')}
          </button>
        </SheetMessage>
      );
    }
    if (items.length === 0) {
      return (
        <SheetMessage>
          <p>{status ? t('sheet.emptyFiltered') : t('sheet.empty')}</p>
        </SheetMessage>
      );
    }
    return <ContactSheet items={items} onDismiss={handleDismiss} />;
  };

  return (
    <>
      <UploadPanel />

      <section className={styles.sheetSection} aria-labelledby="sheet-title">
        <div className={styles.sheetHeader}>
          <h2 id="sheet-title" className={styles.sheetTitle}>
            {t('sheet.title')}
          </h2>
          <StatusFilter value={status} onChange={setStatus} />
        </div>
        {renderSheet()}
      </section>
    </>
  );
}
