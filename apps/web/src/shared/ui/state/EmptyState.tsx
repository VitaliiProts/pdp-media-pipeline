import { type ReactNode } from 'react';
import styles from './State.module.css';

type EmptyStateProps = {
  title: string;
  children?: ReactNode;
  /** The next step, e.g. a button that creates the first item. */
  action?: ReactNode;
  headingLevel?: 2 | 3;
};

export function EmptyState({ title, children, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.state} role="status">
      <Heading className={styles.title}>{title}</Heading>
      {children && <div className={styles.body}>{children}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
