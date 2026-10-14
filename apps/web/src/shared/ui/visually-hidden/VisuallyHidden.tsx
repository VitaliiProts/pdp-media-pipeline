import { type ReactNode } from 'react';
import styles from './VisuallyHidden.module.css';

/** Read by screen readers, not shown. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>;
}
