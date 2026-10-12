import { useTranslation } from 'react-i18next';
import { useGetRuntimeConfigQuery } from '../../../shared/api/runtime-config';
import { jobTraceUrl, type TraceTarget } from '../lib/trace-url';
import styles from './TraceLink.module.css';

/** Hidden until the deployment says where Grafana is; the job works the same without it. */
export function TraceLink(target: TraceTarget) {
  const { t } = useTranslation('jobs');
  const { data } = useGetRuntimeConfigQuery();
  if (!data?.grafanaUrl) return null;

  return (
    <a
      className={styles.link}
      href={jobTraceUrl(data.grafanaUrl, target)}
      target="_blank"
      rel="noreferrer"
    >
      {t('trace.open')}
    </a>
  );
}
