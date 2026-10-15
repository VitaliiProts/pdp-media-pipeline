import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { apiKeyCleared } from '../../features/api-key';
import { useGetMeQuery, useLogoutMutation } from '../../features/session';
import { useAppDispatch } from '../../shared/lib/redux';
import { Button } from '../../shared/ui/button/Button';
import { useToast } from '../../shared/ui/toast/toast-context';
import { LanguageSwitch } from './LanguageSwitch';
import styles from './UserMenu.module.css';

/**
 * A disclosure: the button toggles a panel; Escape, a click outside and a move
 * to another page close it.
 */
export function UserMenu() {
  const { t } = useTranslation('shell');
  const { data: me } = useGetMeQuery();
  const [logout, { isLoading: isSigningOut }] = useLogoutMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const { pathname } = useLocation();
  const [isOpen, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  if (!me) return null;
  const displayName = me.email ?? me.name;

  const signOut = async () => {
    if (me.authMethod === 'session') {
      try {
        await logout().unwrap();
      } catch {
        toast({ tone: 'danger', message: t('menu.signOutFailed') });
        return;
      }
    }
    // Also resets the API cache, so the next user starts clean.
    dispatch(apiKeyCleared());
    void navigate('/login');
  };

  return (
    <div ref={rootRef} className={styles.menu}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={t('menu.label', { name: displayName })}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen((open) => !open)}
      >
        <span className={styles.initial} aria-hidden="true">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.name} aria-hidden="true">
          {displayName}
        </span>
      </button>
      <div id={panelId} className={styles.panel} hidden={!isOpen}>
        <p className={styles.who}>{t('menu.signedInAs', { name: displayName })}</p>
        <ul className={styles.items}>
          <li>
            <Link to="/settings" className={styles.item} onClick={() => setOpen(false)}>
              {t('menu.settings')}
            </Link>
          </li>
          <li>
            <a
              className={styles.item}
              href="/docs"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              {t('menu.apiDocs')}
            </a>
          </li>
        </ul>
        <LanguageSwitch />
        <Button variant="quiet" size="sm" isBusy={isSigningOut} onClick={() => void signOut()}>
          {t('menu.signOut')}
        </Button>
      </div>
    </div>
  );
}
