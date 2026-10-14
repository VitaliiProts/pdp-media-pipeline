import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';
import { cx } from '../../lib/cx';
import { Button } from '../button/Button';
import styles from './Dialog.module.css';

type DialogProps = Omit<
  ComponentProps<'dialog'>,
  'open' | 'onClose' | 'title' | 'children' | 'ref' | 'onCancel' | 'onClick' | 'aria-labelledby'
> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  ref?: never;
  onCancel?: never;
  onClick?: never;
  'aria-labelledby'?: never;
};

/**
 * A modal `<dialog>`: the browser traps focus, makes the page inert and turns
 * Escape into `cancel`. Focus goes back to whatever had it before opening.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
  className,
  ...rest
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, [open]);

  return (
    <dialog
      {...rest}
      ref={ref}
      className={cx(styles.dialog, className)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={styles.frame}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <Button variant="quiet" size="sm" aria-label={closeLabel} onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </header>
          <div className={styles.body}>{children}</div>
        </div>
      )}
    </dialog>
  );
}
