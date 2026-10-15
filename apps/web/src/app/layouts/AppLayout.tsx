import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { UploadDialogProvider, useOpenUpload } from '../../features/upload';
import { Button } from '../../shared/ui/button/Button';
import { useToast } from '../../shared/ui/toast/toast-context';
import styles from './AppLayout.module.css';
import { useUploadFailureToasts } from './use-upload-failure-toasts';
import { UserMenu } from './UserMenu';

const NAV_ITEMS = [
  { to: '/library', labelKey: 'nav.library' },
  { to: '/jobs', labelKey: 'nav.jobs' },
  { to: '/webhooks', labelKey: 'nav.webhooks' },
] as const;

export function AppLayout() {
  const { t } = useTranslation('shell');
  const toast = useToast();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const headingTo = useUploadFailureToasts();

  const handleStarted = (count: number) => {
    if (pathname !== '/library') {
      headingTo('/library');
      void navigate('/library');
    }
    toast({ tone: 'progress', message: t('upload.started', { count }) });
  };

  return (
    <UploadDialogProvider onStarted={handleStarted}>
      <div className={styles.page}>
        <a className={styles.skip} href="#main">
          {t('skipToContent')}
        </a>
        <header className={styles.header}>
          <Link to="/library" className={styles.brand}>
            {t('brand')}
          </Link>
          <nav className={styles.nav} aria-label={t('nav.main')}>
            <ul className={styles.navList}>
              {NAV_ITEMS.map(({ to, labelKey }) => (
                <li key={to}>
                  <NavLink to={to} className={styles.navLink}>
                    {t(labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles.actions}>
            <UploadButton label={t('upload.open')} />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className={styles.main}>
          <Outlet />
        </main>
      </div>
    </UploadDialogProvider>
  );
}

function UploadButton({ label }: { label: string }) {
  const openUpload = useOpenUpload();
  return (
    <Button variant="primary" size="sm" onClick={openUpload}>
      {label}
    </Button>
  );
}
