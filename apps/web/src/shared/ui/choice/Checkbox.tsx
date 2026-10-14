import { type ComponentProps, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Choice.module.css';

export type ChoiceProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: ReactNode;
  /** Secondary text after the label, e.g. a size. */
  detail?: ReactNode;
};

export function Checkbox({ label, detail, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx(styles.choice, className)}>
      <input {...rest} type="checkbox" className={styles.control} />
      <span className={styles.label}>{label}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </label>
  );
}
