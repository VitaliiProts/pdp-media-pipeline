import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';

export function LandingPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.page}>
      <PageHeading>{t('landing.title')}</PageHeading>
      <p className={styles.lead}>{t('landing.lead')}</p>
      <div className={styles.actions}>
        <Link to="/library" className={buttonClass({ variant: 'primary' })}>
          {t('landing.openLibrary')}
        </Link>
        <Link to="/register" className={buttonClass({ variant: 'secondary' })}>
          {t('register')}
        </Link>
      </div>
    </div>
  );
}
