import { type ReactNode } from 'react';
import { Button } from '../button/Button';
import styles from './State.module.css';

type ErrorStateProps = {
  title: string;
  children?: ReactNode;
  retry?: { label: string; onRetry: () => void };
  headingLevel?: 2 | 3;
};

export function ErrorState({ title, children, retry, headingLevel = 2 }: ErrorStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.state} data-tone="danger" role="alert">
      <Heading className={styles.title}>{title}</Heading>
      {children && <div className={styles.body}>{children}</div>}
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
