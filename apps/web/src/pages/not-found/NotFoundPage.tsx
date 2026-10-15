import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';

export function NotFoundPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('notFound.title')}</PageHeading>
      <p className={styles.lead}>{t('notFound.body')}</p>
      <div className={styles.actions}>
        <Link to="/library" className={buttonClass({ variant: 'primary' })}>
          {t('notFound.toLibrary')}
        </Link>
      </div>
    </div>
  );
}
