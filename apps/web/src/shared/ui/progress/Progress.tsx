import { cx } from '../../lib/cx';
import styles from './Progress.module.css';

type ProgressProps = { label: string; value?: number; max?: number; className?: string };

/** Without `value` the bar is indeterminate. */
export function Progress({ label, value, max = 1, className }: ProgressProps) {
  return (
    <progress
      className={cx(styles.progress, className)}
      aria-label={label}
      value={value}
      max={max}
    />
  );
}
