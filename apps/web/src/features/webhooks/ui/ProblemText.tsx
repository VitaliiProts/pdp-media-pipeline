import { useTranslation } from 'react-i18next';
import { type WebhookProblem } from '../model/problem';
import styles from './Webhooks.module.css';

export function ProblemText({ problem }: { problem: WebhookProblem }) {
  const { t } = useTranslation('webhooks');
  return (
    <p className={styles.problem} role="alert">
      {t(problem.key)}
      {problem.detail && <span className={styles.detail}>{problem.detail}</span>}
    </p>
  );
}
