import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';
import { ApiKeyForm } from '../../features/api-key';
import { useGetMeQuery } from '../../features/session';
import { safeReturnTo } from '../../shared/lib/return-to';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import styles from '../page.module.css';

export function LoginPage() {
  const { t } = useTranslation('shell');
  const [params] = useSearchParams();
  const me = useGetMeQuery();

  if (me.data) return <Navigate to={safeReturnTo(params.get('next'))} replace />;

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('login.title')}</PageHeading>
      {me.isLoading ? <Skeleton height="12rem" radius="mount" /> : <ApiKeyForm />}
    </div>
  );
}
