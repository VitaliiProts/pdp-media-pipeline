import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { RegisterForm, SignedOutGate } from '../../features/auth';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import styles from '../page.module.css';

export function RegisterPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  const next = params.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('registerPage.title')}</PageHeading>
      <SignedOutGate next={next} placeholder={<Skeleton height="22rem" radius="mount" />}>
        <RegisterForm loginHref={loginHref} />
      </SignedOutGate>
      <p className={styles.switch}>
        {tAuth('register.haveAccount')} <Link to={loginHref}>{tAuth('register.toLogin')}</Link>
      </p>
    </div>
  );
}
