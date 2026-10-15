import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { ToastProvider } from '../../shared/ui/toast/ToastProvider';

/** Where 5c.3 kept the API key; sign-in is a session cookie now. */
const LEGACY_API_KEY_STORAGE = 'pdp.apiKey';

/** Root of every route: toasts live inside the router, so their actions can be links. */
export function AppRoot() {
  const { t } = useTranslation('shell');
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_API_KEY_STORAGE);
    } catch {
      // Blocked site storage throws; then there is no old key to forget either.
    }
  }, []);
  return (
    <ToastProvider closeLabel={t('close')}>
      <Outlet />
    </ToastProvider>
  );
}
