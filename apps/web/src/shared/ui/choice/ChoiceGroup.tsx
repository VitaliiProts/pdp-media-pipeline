import { type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Choice.module.css';

type ChoiceGroupProps = { legend: ReactNode; children: ReactNode; className?: string };

export function ChoiceGroup({ legend, children, className }: ChoiceGroupProps) {
  return (
    <fieldset className={cx(styles.group, className)}>
      <legend className={styles.legend}>{legend}</legend>
      {children}
    </fieldset>
  );
}
