import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';
import { ApiKeyForm } from '../../features/api-key';
import { useGetMeQuery } from '../../features/session';
import { isUnauthorized, retryAfterOf } from '../../shared/api/http';
import { safeReturnTo } from '../../shared/lib/return-to';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import styles from '../page.module.css';

export function LoginPage() {
  const { t } = useTranslation('shell');
  const [params] = useSearchParams();
  const me = useGetMeQuery();

  if (me.data) return <Navigate to={safeReturnTo(params.get('next'))} replace />;

  // A 401 just means "not signed in yet"; anything else is worth saying, but the form stays.
  const checkFailed = me.isError && !isUnauthorized(me.error);
  const retryAfterS = retryAfterOf(me.error);

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('login.title')}</PageHeading>
      {checkFailed && (
        <ErrorState
          title={t('auth.unavailableTitle')}
          retry={{ label: t('retry'), onRetry: () => void me.refetch() }}
        >
          <p>
            {retryAfterS === null
              ? t('auth.unavailable')
              : t('auth.tooManyRequests', { count: retryAfterS })}
          </p>
        </ErrorState>
      )}
      {me.isLoading ? <Skeleton height="12rem" radius="mount" /> : <ApiKeyForm />}
    </div>
  );
}
