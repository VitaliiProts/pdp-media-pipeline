import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import styles from '../page.module.css';

export function LibraryPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.page}>
      <PageHeading>{t('library.title')}</PageHeading>
      <EmptyState
        title={t('library.emptyTitle')}
        action={
          <Link to="/jobs" className={buttonClass({ variant: 'primary' })}>
            {t('library.toJobs')}
          </Link>
        }
      >
        <p>{t('library.emptyBody')}</p>
      </EmptyState>
    </div>
  );
}
