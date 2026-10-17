import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { RegisterForm, SignedOutGate } from '../../features/auth';
import { useHydrated } from '../../shared/lib/use-hydrated';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';

export function RegisterPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  // The prerendered page was built without a query string.
  const next = useHydrated() ? params.get('next') : null;
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('registerPage.title')}</PageHeading>
      <SignedOutGate next={next}>
        <RegisterForm loginHref={loginHref} />
      </SignedOutGate>
      <p className={styles.switch}>
        {tAuth('register.haveAccount')} <Link to={loginHref}>{tAuth('register.toLogin')}</Link>
      </p>
    </div>
  );
}
