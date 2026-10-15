import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { safeStorage } from '../../shared/lib/safe-storage';
import { ToastProvider } from '../../shared/ui/toast/ToastProvider';
import { storedLanguage } from '../i18n';

/** Where 5c.3 kept the API key; sign-in is a session cookie now. */
const LEGACY_API_KEY_STORAGE = 'pdp.apiKey';

/** Root of every route: toasts live inside the router, so their actions can be links. */
export function AppRoot() {
  const { t, i18n } = useTranslation('shell');
  useEffect(() => safeStorage.remove(LEGACY_API_KEY_STORAGE), []);
  // A prerendered page hydrates in the language it was built in; the visitor's own follows.
  useEffect(() => {
    const language = storedLanguage();
    if (language && language !== i18n.resolvedLanguage) void i18n.changeLanguage(language);
  }, [i18n]);
  return (
    <ToastProvider closeLabel={t('close')}>
      <Outlet />
    </ToastProvider>
  );
}
