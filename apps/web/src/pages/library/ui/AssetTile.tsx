import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type AssetSummary, isActiveJobStatus } from '../../../features/assets';
import { STATUS_LABEL_KEY, STATUS_TONE } from '../../../features/jobs';
import { formatBytes } from '../../../shared/lib/format-bytes';
import { formatDuration } from '../../../shared/lib/format-duration';
import { Badge } from '../../../shared/ui/badge/Badge';
import { Card } from '../../../shared/ui/card/Card';
import { Progress } from '../../../shared/ui/progress/Progress';
import styles from './AssetTile.module.css';

const progressOf = (percent: number | null | undefined) =>
  percent === null || percent === undefined ? undefined : percent / 100;

/** Sent along to the file page, so its breadcrumb returns to the same filters. */
export type LibraryLinkState = { librarySearch: string };

type AssetTileProps = { asset: AssetSummary; linkState: LibraryLinkState };

export function AssetTile({ asset, linkState }: AssetTileProps) {
  const { t, i18n } = useTranslation('assets');
  const { t: tJobs } = useTranslation('jobs');
  const name = asset.name ?? t('tile.untitled');
  const nameId = useId();
  const job = asset.latestJob;

  return (
    <Card className={styles.tile}>
      <Link to={`/library/${asset.id}`} state={linkState} className={styles.link}>
        <span id={nameId} className={styles.name} title={name}>
          {name}
        </span>
        <span className={styles.frame}>
          {asset.preview ? (
            <img
              className={styles.image}
              src={asset.preview.url}
              width={asset.preview.width}
              height={asset.preview.height}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className={styles.placeholder} aria-hidden="true">
              {asset.kind === 'video' ? '▶' : '◻'}
            </span>
          )}
          {asset.kind === 'video' && (
            <span className={styles.kind}>
              {asset.durationSeconds === null
                ? t('tile.video')
                : t('tile.videoWithDuration', { duration: formatDuration(asset.durationSeconds) })}
            </span>
          )}
        </span>
      </Link>
      <span className={styles.meta}>
        {job && isActiveJobStatus(job.status) && (
          <Progress
            className={styles.bar}
            label={t('tile.progress')}
            // Empty while waiting, indeterminate until the job reports a percent.
            value={job.status === 'running' ? progressOf(job.progress) : 0}
            aria-describedby={nameId}
          />
        )}
        {job && <Badge tone={STATUS_TONE[job.status]}>{tJobs(STATUS_LABEL_KEY[job.status])}</Badge>}
        {asset.size !== null && <span>{formatBytes(asset.size, i18n.language)}</span>}
      </span>
    </Card>
  );
}
