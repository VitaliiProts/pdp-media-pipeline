import { useTranslation } from 'react-i18next';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { VisuallyHidden } from '../../shared/ui/visually-hidden/VisuallyHidden';
import styles from './AppLayout.module.css';

/** Shown while a lazy page or the sign-in check is loading. */
export function RouteFallback() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.fallback} role="status" aria-busy="true">
      <VisuallyHidden>{t('loading')}</VisuallyHidden>
      <Skeleton height="3rem" />
      <Skeleton height="14rem" radius="mount" />
    </div>
  );
}
