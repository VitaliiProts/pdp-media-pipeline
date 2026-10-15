import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';

export function RegisterPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('registerPage.title')}</PageHeading>
      <p className={styles.lead}>{t('registerPage.body')}</p>
      <div className={styles.actions}>
        <Link to="/login" className={buttonClass({ variant: 'primary' })}>
          {t('registerPage.toLogin')}
        </Link>
      </div>
    </div>
  );
}
