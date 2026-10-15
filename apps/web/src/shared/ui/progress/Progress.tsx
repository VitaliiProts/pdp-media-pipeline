import { type ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import styles from './Progress.module.css';

type ProgressProps = Omit<
  ComponentProps<'progress'>,
  'value' | 'max' | 'children' | 'aria-label' | 'role'
> & {
  label: string;
  value?: number;
  max?: number;
  'aria-label'?: never;
};

/** Without `value` the bar is indeterminate. */
export function Progress({ label, value, max = 1, className, ...rest }: ProgressProps) {
  return (
    <progress
      {...rest}
      className={cx(styles.progress, className)}
      aria-label={label}
      value={value}
      max={max}
    />
  );
}
