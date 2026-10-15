import { useTranslation } from 'react-i18next';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import styles from './AppLayout.module.css';

/** A lazy chunk failed to load, usually because a new version replaced it. */
export function RouteError() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.fallback}>
      <ErrorState
        title={t('routeError.title')}
        retry={{ label: t('routeError.reload'), onRetry: () => window.location.reload() }}
      >
        <p>{t('routeError.body')}</p>
      </ErrorState>
    </div>
  );
}
