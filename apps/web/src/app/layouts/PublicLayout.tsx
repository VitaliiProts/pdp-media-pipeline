import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { LanguageSwitch } from './LanguageSwitch';
import styles from './PublicLayout.module.css';

export function PublicLayout() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        {t('skipToContent')}
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          {t('brand')}
        </Link>
        <div className={styles.actions}>
          <LanguageSwitch />
          <nav className={styles.actions} aria-label={t('nav.account')}>
            <NavLink to="/login" className={buttonClass({ variant: 'quiet', size: 'sm' })}>
              {t('signIn')}
            </NavLink>
            <NavLink to="/register" className={buttonClass({ variant: 'primary', size: 'sm' })}>
              {t('register')}
            </NavLink>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
