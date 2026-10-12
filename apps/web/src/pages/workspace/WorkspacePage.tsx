import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { apiKeyCleared } from '../../features/api-key';
import { retryAfterOf, StatusFilter, useLiveJobs } from '../../features/jobs';
import { dismissUpload, selectUploads, UploadPanel } from '../../features/upload';
import { useAppDispatch, useAppSelector } from '../../shared/lib/redux';
import { useStatusParam } from './lib/use-status-param';
import { buildSheetItems } from './model/sheet-items';
import { ContactSheet, SheetMessage } from './ui/ContactSheet';
import { LanguageSwitch } from './ui/LanguageSwitch';
import styles from './WorkspacePage.module.css';

export function WorkspacePage() {
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
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>{t('subtitle')}</p>
        <nav className={styles.tools}>
          <a className={styles.link} href="/docs" target="_blank" rel="noreferrer">
            {t('apiDocs')}
          </a>
          <LanguageSwitch />
          <button
            type="button"
            className={styles.signOut}
            onClick={() => dispatch(apiKeyCleared())}
          >
            {t('changeKey')}
          </button>
        </nav>
      </header>

      <main className={styles.main}>
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
      </main>
    </div>
  );
}
