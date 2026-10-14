import { type ComponentProps, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { type Tone } from '../tone';
import styles from './Badge.module.css';

type BadgeProps = Omit<ComponentProps<'span'>, 'children'> & { tone: Tone; children: ReactNode };

export function Badge({ tone, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx(styles.badge, className)} data-tone={tone}>
      {children}
    </span>
  );
}
