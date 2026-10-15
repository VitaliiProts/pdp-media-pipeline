import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { ToastProvider } from '../../shared/ui/toast/ToastProvider';

/** Root of every route: toasts live inside the router, so their actions can be links. */
export function AppRoot() {
  const { t } = useTranslation('shell');
  return (
    <ToastProvider closeLabel={t('close')}>
      <Outlet />
    </ToastProvider>
  );
}
