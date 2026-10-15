import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui/button/Button';
import { useRedriveJobMutation } from '../api/jobs-api';
import styles from './RedriveButton.module.css';

type RedriveButtonProps = { jobId: string };

/** Sends a dead job through the pipeline again; every list of jobs refetches and shows it queued. */
export function RedriveButton({ jobId }: RedriveButtonProps) {
  const { t } = useTranslation('jobs');
  const [redrive, { isLoading, isError, error }] = useRedriveJobMutation();
  const isRetryLater = isError && 'kind' in error && error.kind === 'retryLater';

  return (
    <div className={styles.root}>
      <Button variant="quiet" size="sm" isBusy={isLoading} onClick={() => void redrive(jobId)}>
        {isLoading ? t('redrive.pending') : t('redrive.action')}
      </Button>
      {isError && (
        <p className={styles.problem} role="alert">
          {isRetryLater ? t('redrive.busy') : t('redrive.failed')}
        </p>
      )}
    </div>
  );
}
