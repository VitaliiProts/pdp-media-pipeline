import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useGetMeQuery } from '../../features/session';
import { isUnauthorized, retryAfterOf } from '../../shared/api/http';
import { loginPath } from '../../shared/lib/return-to';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import styles from './AppLayout.module.css';
import { RouteFallback } from './RouteFallback';

/** The app shell is for signed-in users: a session cookie or an API key. */
export function RequireAuth() {
  const { t } = useTranslation('shell');
  const location = useLocation();
  const me = useGetMeQuery();

  if (me.isLoading) return <RouteFallback />;
  if (isUnauthorized(me.error)) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }
  if (!me.data) {
    const retryAfterS = retryAfterOf(me.error);
    return (
      <div className={styles.fallback}>
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
      </div>
    );
  }
  return <Outlet />;
}
