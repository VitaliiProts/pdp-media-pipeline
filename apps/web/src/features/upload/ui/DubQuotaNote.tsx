import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../../shared/lib/format-duration';
import { Button } from '../../../shared/ui/button/Button';
import { useGetDubQuotaQuery } from '../api/dub-api';
import styles from './Dub.module.css';

/** What is left of the month's dub seconds, with the loading and failed states of the check. */
export function DubQuotaNote() {
  const { t, i18n } = useTranslation('upload');
  const { t: tShell } = useTranslation('shell');
  const quota = useGetDubQuotaQuery();

  if (quota.data) {
    const resets = new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'long',
    }).format(new Date(quota.data.resetsAt));
    return (
      <p className={styles.note}>
        {t('dub.quota.left', {
          left: formatDuration(quota.data.remainingSeconds),
          limit: formatDuration(quota.data.limitSeconds),
          date: resets,
        })}
      </p>
    );
  }
  if (quota.isError) {
    return (
      <p className={styles.problem} role="alert">
        {t('dub.quota.error')}{' '}
        <Button size="sm" variant="quiet" onClick={() => void quota.refetch()}>
          {tShell('retry')}
        </Button>
      </p>
    );
  }
  return (
    <p className={styles.note} role="status">
      {t('dub.quota.loading')}
    </p>
  );
}
