import { useTranslation } from 'react-i18next';
import { useRedriveJobMutation } from '../../../features/jobs';
import styles from './SlideMount.module.css';

type RedriveButtonProps = { jobId: string };

/** Sends a dead job through the pipeline again; the list refetches and shows it queued. */
export function RedriveButton({ jobId }: RedriveButtonProps) {
  const { t } = useTranslation('workspace');
  const [redrive, { isLoading, isError, error }] = useRedriveJobMutation();
  const isBusy = isError && 'kind' in error && error.kind === 'retryLater';

  return (
    <>
      <button
        type="button"
        className={styles.action}
        disabled={isLoading}
        onClick={() => void redrive(jobId)}
      >
        {isLoading ? t('redrive.pending') : t('redrive.action')}
      </button>
      {isError && (
        <p className={styles.problem} role="alert">
          {isBusy ? t('redrive.busy') : t('redrive.failed')}
        </p>
      )}
    </>
  );
}
