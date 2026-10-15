import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';
import { cx } from '../../lib/cx';
import { Button } from '../button/Button';
import styles from './Dialog.module.css';

type DialogProps = Omit<
  ComponentProps<'dialog'>,
  | 'open'
  | 'onClose'
  | 'title'
  | 'children'
  | 'ref'
  | 'onCancel'
  | 'onClick'
  | 'onPointerDown'
  | 'aria-labelledby'
> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  /**
   * `false` while something in it must finish: Escape, the backdrop and × do nothing,
   * and a close the browser forces anyway (Chrome, on a repeated Escape) opens it again.
   */
  dismissible?: boolean;
  ref?: never;
  onCancel?: never;
  onClick?: never;
  onPointerDown?: never;
  'aria-labelledby'?: never;
};

/**
 * A modal `<dialog>`: the browser traps focus, makes the page inert and turns
 * Escape into `cancel`. Focus goes back to whatever had it before opening, or
 * to the page `h1` if that element is gone.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
  dismissible = true,
  className,
  ...rest
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      const heading = document.querySelector('h1');
      if (opener?.isConnected) opener.focus();
      else if (heading instanceof HTMLElement) heading.focus();
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
        if (dismissible) onClose();
      }}
      onClose={(event) => {
        if (!open) return;
        const dialog = event.currentTarget;
        if (dismissible) onClose();
        else if (dialog.isConnected) dialog.showModal();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A press that starts inside and is released over the backdrop also targets the dialog.
        const onBackdrop = pressedBackdrop.current && event.target === event.currentTarget;
        pressedBackdrop.current = false;
        if (onBackdrop && dismissible) onClose();
      }}
    >
      {open && (
        <div className={styles.frame}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <Button
              variant="quiet"
              size="sm"
              aria-label={closeLabel}
              isBusy={!dismissible}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </header>
          <div className={styles.body}>{children}</div>
        </div>
      )}
    </dialog>
  );
}
