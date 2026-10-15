import { type ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import styles from './VisuallyHidden.module.css';

/** Read by screen readers, not shown. */
export function VisuallyHidden({ className, ...rest }: ComponentProps<'span'>) {
  return <span {...rest} className={cx(styles.hidden, className)} />;
}
