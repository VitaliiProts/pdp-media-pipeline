import { appErrorOf } from '../../../shared/api/http';

/** Why the gateway refused a sign-in or a sign-up, in terms the form can show. */
export type AuthFailure =
  | { kind: 'credentials' }
  | { kind: 'emailTaken' }
  | { kind: 'retryLater'; retryAfterS: number }
  | { kind: 'refused'; message: string }
  | { kind: 'unavailable' };

export function authFailureOf(error: unknown): AuthFailure {
  const appError = appErrorOf(error);
  switch (appError?.kind) {
    case 'unauthorized':
      return { kind: 'credentials' };
    case 'retryLater':
      return { kind: 'retryLater', retryAfterS: appError.retryAfterS };
    case 'http':
      if (appError.code === 'EMAIL_TAKEN') return { kind: 'emailTaken' };
      return appError.status >= 500
        ? { kind: 'unavailable' }
        : { kind: 'refused', message: appError.message };
    default:
      return { kind: 'unavailable' };
  }
}
