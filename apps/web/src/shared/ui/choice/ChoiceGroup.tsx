import { type ComponentProps, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Choice.module.css';

type ChoiceGroupProps = Omit<ComponentProps<'fieldset'>, 'children'> & {
  legend: ReactNode;
  children: ReactNode;
};

export function ChoiceGroup({ legend, children, className, ...rest }: ChoiceGroupProps) {
  return (
    <fieldset {...rest} className={cx(styles.group, className)}>
      <legend className={styles.legend}>{legend}</legend>
      {children}
    </fieldset>
  );
}
