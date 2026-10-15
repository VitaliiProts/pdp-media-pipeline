import { Navigate, Outlet, useLocation } from 'react-router';
import { SessionCheckFailure, useGetMeQuery } from '../../features/auth';
import { isUnauthorized } from '../../shared/api/http';
import { loginPath } from '../../shared/lib/return-to';
import styles from './AppLayout.module.css';
import { RouteFallback } from './RouteFallback';

/** The app shell is for signed-in users. */
export function RequireAuth() {
  const location = useLocation();
  const me = useGetMeQuery();

  if (me.isLoading) return <RouteFallback />;
  if (isUnauthorized(me.error)) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }
  if (!me.data) {
    return (
      <div className={styles.fallback}>
        <SessionCheckFailure error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  return <Outlet />;
}
