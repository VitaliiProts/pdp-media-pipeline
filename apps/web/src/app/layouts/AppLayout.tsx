import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import styles from './AppLayout.module.css';
import { UserMenu } from './UserMenu';

const NAV_ITEMS = [
  { to: '/library', labelKey: 'nav.library' },
  { to: '/jobs', labelKey: 'nav.jobs' },
  { to: '/webhooks', labelKey: 'nav.webhooks' },
] as const;

export function AppLayout() {
  const { t } = useTranslation('shell');
  return (
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
          <UserMenu />
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
