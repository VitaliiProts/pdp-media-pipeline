import { type ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import styles from './Select.module.css';

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select {...rest} className={cx(styles.select, className)} />;
}
