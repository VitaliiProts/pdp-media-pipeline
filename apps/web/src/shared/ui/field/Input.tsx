import { type ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import styles from './Field.module.css';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={cx(styles.input, className)} />;
}
