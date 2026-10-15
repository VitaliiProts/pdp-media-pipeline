import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { LoginForm, SignedOutGate } from '../../features/auth';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import styles from '../page.module.css';

export function LoginPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  const next = params.get('next');

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('login.title')}</PageHeading>
      <SignedOutGate next={next} placeholder={<Skeleton height="16rem" radius="mount" />}>
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
