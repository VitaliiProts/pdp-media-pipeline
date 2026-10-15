import { type FocusEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../button/Button';
import { ToastContext, type ToastInput } from './toast-context';
import styles from './Toast.module.css';

export const TOAST_TIMEOUT_MS = 5000;
export const MAX_TOASTS = 3;

type ToastItem = ToastInput & { id: number };

type ToastProviderProps = { closeLabel: string; children: ReactNode };

/**
 * Both live regions are always in the DOM, so screen readers pick up the first
 * toast too: polite for news, assertive for failures. They carry `aria-live`
 * rather than `role="status"` / `role="alert"`, so an empty region is not a
 * second alert on every page.
 */
export function ToastProvider({ closeLabel, children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { ...toast, id }].slice(-MAX_TOASTS));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const render = (toast: ToastItem) => (
    <ToastCard key={toast.id} toast={toast} closeLabel={closeLabel} onDismiss={dismiss} />
  );

  return (
    <ToastContext value={show}>
      {children}
      <div className={styles.viewport}>
        <div aria-live="polite" className={styles.region}>
          {toasts.filter((toast) => toast.tone !== 'danger').map(render)}
        </div>
        <div aria-live="assertive" className={styles.region}>
          {toasts.filter((toast) => toast.tone === 'danger').map(render)}
        </div>
      </div>
    </ToastContext>
  );
}

type ToastCardProps = {
  toast: ToastItem;
  closeLabel: string;
  onDismiss: (id: number) => void;
};

function ToastCard({ toast, closeLabel, onDismiss }: ToastCardProps) {
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const isPaused = isHovered || isFocused;
  const { id } = toast;

  useEffect(() => {
    if (isPaused) return;
    const timer = setTimeout(() => onDismiss(id), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPaused, id, onDismiss]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
  };

  return (
    <div
      className={styles.toast}
      data-tone={toast.tone ?? 'neutral'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    >
      <div className={styles.message}>{toast.message}</div>
      {toast.action}
      <Button variant="quiet" size="sm" aria-label={closeLabel} onClick={() => onDismiss(id)}>
        <span aria-hidden="true">×</span>
      </Button>
    </div>
  );
}
