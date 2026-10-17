import { type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { isUnauthorized } from '../../../shared/api/http';
import { safeReturnTo } from '../../../shared/lib/return-to';
import { useGetMeQuery } from '../api/auth-api';
import { SessionCheckFailure } from './SessionCheckFailure';

type SignedOutGateProps = { next: string | null; children: ReactNode };

/**
 * Shows sign-in and sign-up forms to visitors only; someone signed in goes on to `next`. The
 * form stays up while the session is checked: it is in the prerendered HTML, and swapping it for
 * a placeholder until `GET /v1/me` answers would make it blink.
 */
export function SignedOutGate({ next, children }: SignedOutGateProps) {
  const me = useGetMeQuery();

  // A session that ended mid-work leaves the last user in `data` until the next sign-in.
  if (me.data && !me.isError) return <Navigate to={safeReturnTo(next)} replace />;

  // A 401 just means "not signed in yet"; anything else is worth saying, but the form stays.
  return (
    <>
      {me.isError && !isUnauthorized(me.error) && (
        <SessionCheckFailure error={me.error} onRetry={() => void me.refetch()} />
      )}
      {children}
    </>
  );
}
