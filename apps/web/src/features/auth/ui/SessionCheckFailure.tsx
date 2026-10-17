import { useTranslation } from 'react-i18next';
import { retryAfterOf } from '../../../shared/api/http';
import { ErrorState } from '../../../shared/ui/state/ErrorState';

type SessionCheckFailureProps = { error: unknown; onRetry: () => void };

/** `GET /v1/me` failed with something other than a 401, so it is unknown who is signed in. */
export function SessionCheckFailure({ error, onRetry }: SessionCheckFailureProps) {
  const { t } = useTranslation('auth');
  const retryAfterS = retryAfterOf(error);
  return (
    <ErrorState title={t('sessionCheck.title')} retry={{ label: t('sessionCheck.retry'), onRetry }}>
      <p>
        {retryAfterS === null
          ? t('sessionCheck.unavailable')
          : t('sessionCheck.tooManyRequests', { count: retryAfterS })}
      </p>
    </ErrorState>
  );
}
