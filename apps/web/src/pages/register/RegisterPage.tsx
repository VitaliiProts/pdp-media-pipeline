import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';

export function RegisterPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('registerPage.title')}</PageHeading>
      <p className={styles.switch}>
        {tAuth('register.haveAccount')} <Link to="/login">{tAuth('register.toLogin')}</Link>
      </p>
    </div>
  );
}
