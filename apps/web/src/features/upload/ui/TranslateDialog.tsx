import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appErrorOf, type AppError } from '../../../shared/api/http';
import { formatDuration } from '../../../shared/lib/format-duration';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useGetDubQuotaQuery, useStartDubMutation } from '../api/dub-api';
import {
  DEFAULT_DUB_SETTINGS,
  type DubBlock,
  dubBlockOf,
  type DubSettings,
  isSameLanguage,
} from '../model/dub';
import styles from './Dub.module.css';
import { DubOptions } from './DubOptions';
import { DubQuotaNote } from './DubQuotaNote';

/** A video of the library: the quota counts the duration the library knows. */
export type DubbableFile = {
  assetId: string;
  sourceKey: string;
  name: string;
  durationSeconds: number | null;
};

type TranslateDialogProps = {
  open: boolean;
  onClose: () => void;
  file: DubbableFile;
  onStarted: (jobId: string) => void;
};

const BLOCK_KEY = {
  tooLong: 'dub.confirm.tooLong',
  overQuota: 'dub.confirm.overQuota',
} as const satisfies Record<DubBlock, string>;

function failureKey(error: AppError | null) {
  if (error?.kind === 'http' && error.code === 'DUB_QUOTA_EXCEEDED') return 'dub.confirm.overQuota';
  if (error?.kind === 'retryLater') return 'dub.dialog.retryLater';
  return 'dub.dialog.failed';
}

export function TranslateDialog({ open, onClose, file, onStarted }: TranslateDialogProps) {
  const { t } = useTranslation('upload');
  const [settings, setSettings] = useState<DubSettings>(DEFAULT_DUB_SETTINGS);
  const quota = useGetDubQuotaQuery(undefined, { skip: !open });
  const [startDub, started] = useStartDubMutation();
  const block = quota.data
    ? dubBlockOf(file.durationSeconds, quota.data, { measured: true })
    : null;
  const error = appErrorOf(started.error);
  const detail = error?.kind === 'http' && error.status === 400 ? error.message : null;

  const close = () => {
    started.reset();
    onClose();
  };

  const start = async () => {
    const result = await startDub({
      ...settings,
      assetId: file.assetId,
      sourceKey: file.sourceKey,
    });
    if ('data' in result && result.data) onStarted(result.data.jobId);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('dub.dialog.title', { name: file.name })}
      closeLabel={t('dialog.close')}
      dismissible={!started.isLoading}
    >
      <div className={styles.confirm}>
        <p className={styles.note}>
          {file.durationSeconds === null
            ? t('dub.dialog.unknownDuration')
            : t('dub.dialog.duration', { duration: formatDuration(file.durationSeconds) })}
        </p>
        <DubOptions value={settings} onChange={setSettings} />
        <DubQuotaNote />
        {block && quota.data && (
          <p className={styles.problem}>
            {t(BLOCK_KEY[block], { max: formatDuration(quota.data.maxVideoSeconds) })}
          </p>
        )}
        {started.isError && (
          <p className={styles.problem} role="alert">
            {t(failureKey(error))}
            {detail && ` ${detail}`}
          </p>
        )}
        <div className={styles.buttons}>
          <Button
            variant="primary"
            disabled={!quota.data || block !== null || isSameLanguage(settings)}
            isBusy={started.isLoading}
            onClick={() => void start()}
          >
            {t('dub.dialog.start')}
          </Button>
          <Button onClick={close} isBusy={started.isLoading}>
            {t('dub.dialog.cancel')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
