import { type ComponentProps, type ReactNode, useId } from 'react';
import { cx } from '../../lib/cx';
import styles from './Field.module.css';

export type FieldControlProps = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
};

type FieldProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Renders the control with the ids that tie it to the label, hint and error. */
  children: (control: FieldControlProps) => ReactNode;
};

/** An empty string counts as no message, so `error=""` leaves the control valid. */
function isShown(message: ReactNode) {
  return message != null && message !== false && message !== '';
}

export function Field({ label, hint, error, className, children, ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasHint = isShown(hint);
  const hasError = isShown(error);
  const describedBy = cx(hasHint && hintId, hasError && errorId) || undefined;

  return (
    <div {...rest} className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': hasError || undefined })}
      {hasHint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
