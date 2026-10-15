import { useTranslation } from 'react-i18next';
import { type WebhookProblem } from '../model/problem';
import styles from './Webhooks.module.css';

type ProblemTextProps = { problem: WebhookProblem; isAlert?: boolean };

export function ProblemText({ problem, isAlert = true }: ProblemTextProps) {
  const { t } = useTranslation('webhooks');
  return (
    <p className={styles.problem} role={isAlert ? 'alert' : undefined}>
      {t(problem.key)}
      {problem.detail && <span className={styles.detail}>{problem.detail}</span>}
    </p>
  );
}
