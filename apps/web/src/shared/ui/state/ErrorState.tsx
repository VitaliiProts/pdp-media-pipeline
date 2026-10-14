import { type ComponentProps, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Button } from '../button/Button';
import styles from './State.module.css';

type ErrorStateProps = Omit<ComponentProps<'div'>, 'title' | 'role' | 'children'> & {
  title: string;
  children?: ReactNode;
  retry?: { label: string; onRetry: () => void };
  headingLevel?: 2 | 3;
};

export function ErrorState({
  title,
  children,
  retry,
  headingLevel = 2,
  className,
  ...rest
}: ErrorStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div {...rest} className={cx(styles.state, className)} data-tone="danger" role="alert">
      <Heading className={styles.title}>{title}</Heading>
      {children != null && children !== false && <div className={styles.body}>{children}</div>}
      {retry && (
        <div className={styles.action}>
          <Button variant="primary" onClick={retry.onRetry}>
            {retry.label}
          </Button>
        </div>
      )}
    </div>
  );
}
