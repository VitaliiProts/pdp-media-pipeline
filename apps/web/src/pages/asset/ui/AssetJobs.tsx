import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetJob } from '../../../features/assets';
import { STATUS_LABEL_KEY, STATUS_TONE, TraceLink } from '../../../features/jobs';
import { Badge } from '../../../shared/ui/badge/Badge';
import styles from './AssetPage.module.css';

// i18next reads the dot in `image.resize` as nesting, so the keys drop the prefix.
const JOB_TYPE_KEY: Partial<Record<string, string>> = {
  'image.resize': 'jobs.type.resize',
  'video.frames': 'jobs.type.frames',
  'video.transcode': 'jobs.type.transcode',
};

export function AssetJobs({ jobs, hasMore }: { jobs: readonly AssetJob[]; hasMore: boolean }) {
  const { t, i18n } = useTranslation('assets');
  const { t: tJobs } = useTranslation('jobs');
  const { t: tWorkspace } = useTranslation('workspace');
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

  if (jobs.length === 0) return <p className={styles.quiet}>{t('jobs.none')}</p>;

  return (
    <div className={styles.jobsPanel}>
      <ul className={styles.jobs}>
        {jobs.map((job) => {
          const typeKey = JOB_TYPE_KEY[job.type];
          return (
            <li key={job.id} className={styles.job}>
              <span className={styles.jobType}>{typeKey ? t(typeKey) : job.type}</span>
              <Badge tone={STATUS_TONE[job.status]}>{tJobs(STATUS_LABEL_KEY[job.status])}</Badge>
              <time dateTime={job.createdAt}>{dateTime.format(new Date(job.createdAt))}</time>
              <span>{tWorkspace('attempt', { count: job.attempts })}</span>
              {job.lastError && <p className={styles.jobError}>{job.lastError}</p>}
              <TraceLink jobId={job.id} traceId={job.traceId} createdAt={job.createdAt} />
            </li>
          );
        })}
      </ul>
      {hasMore && <p className={styles.quiet}>{t('jobs.newestOnly', { count: jobs.length })}</p>}
    </div>
  );
}
