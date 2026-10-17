import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { LoginForm, SignedOutGate } from '../../features/auth';
import { useHydrated } from '../../shared/lib/use-hydrated';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';

export function LoginPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  // The prerendered page was built without a query string.
  const next = useHydrated() ? params.get('next') : null;

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('login.title')}</PageHeading>
      <SignedOutGate next={next}>
        <LoginForm />
      </SignedOutGate>
      <p className={styles.switch}>
        {tAuth('login.noAccount')}{' '}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>
          {tAuth('login.toRegister')}
        </Link>
      </p>
    </div>
  );
}
