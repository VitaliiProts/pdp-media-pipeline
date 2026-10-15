import { type ComponentProps, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './State.module.css';

type EmptyStateProps = Omit<ComponentProps<'div'>, 'title' | 'role' | 'children'> & {
  title: string;
  children?: ReactNode;
  /** The next step, e.g. a button that creates the first item. */
  action?: ReactNode;
  headingLevel?: 2 | 3;
};

export function EmptyState({
  title,
  children,
  action,
  headingLevel = 2,
  className,
  ...rest
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div {...rest} className={cx(styles.state, className)} role="status">
      <Heading className={styles.title}>{title}</Heading>
      {children != null && children !== false && <div className={styles.body}>{children}</div>}
      {action != null && action !== false && <div className={styles.action}>{action}</div>}
    </div>
  );
}
