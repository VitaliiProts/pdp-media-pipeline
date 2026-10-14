import { type ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import styles from './Card.module.css';

/** A slide on the light table. */
export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return <div {...rest} className={cx(styles.card, className)} />;
}
