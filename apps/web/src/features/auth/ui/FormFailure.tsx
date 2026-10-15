import { useTranslation } from 'react-i18next';
import { type AuthFailure } from '../model/auth-failure';
import styles from './AuthForm.module.css';

type FormFailureProps = { failure: AuthFailure | null; secondsLeft: number };

/** Field-level failures (`emailTaken`) are shown on the field instead. */
export function FormFailure({ failure, secondsLeft }: FormFailureProps) {
  const { t } = useTranslation('auth');
  const message = (() => {
    switch (failure?.kind) {
      case 'credentials':
        return t('failure.credentials');
      case 'retryLater':
        return secondsLeft > 0 ? t('failure.retryLater', { count: secondsLeft }) : null;
      case 'refused':
        return t('failure.refused', { message: failure.message });
      case 'unavailable':
        return t('failure.unavailable');
      default:
        return null;
    }
  })();
  return (
    <p role="alert" className={styles.failure}>
      {message}
    </p>
  );
}
