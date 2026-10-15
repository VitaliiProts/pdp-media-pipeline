import { useTranslation } from 'react-i18next';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import styles from '../page.module.css';

export function SettingsPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.page}>
      <PageHeading>{t('settings.title')}</PageHeading>
      <EmptyState title={t('settings.emptyTitle')}>
        <p>{t('settings.emptyBody')}</p>
      </EmptyState>
    </div>
  );
}
