import { type RefObject, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { STATUS_LABEL_KEY, STATUS_TONE } from '../../../features/jobs';
import {
  Countdown,
  dismissUpload,
  type Upload,
  type UploadProblem,
} from '../../../features/upload';
import { useAppDispatch } from '../../../shared/lib/redux';
import { Badge } from '../../../shared/ui/badge/Badge';
import { Button } from '../../../shared/ui/button/Button';
import { Card } from '../../../shared/ui/card/Card';
import { Progress } from '../../../shared/ui/progress/Progress';
import styles from './AssetTile.module.css';

const PROBLEM_KEY = {
  type: 'problem.type',
  size: 'problem.size',
  empty: 'problem.empty',
  unauthorized: 'problem.unauthorized',
  network: 'problem.network',
  rejected: 'problem.rejected',
  rateLimited: 'problem.rateLimited',
  queueFull: 'problem.queueFull',
  quotaExceeded: 'problem.quotaExceeded',
} as const satisfies Record<UploadProblem, string>;

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

const firstFocusable = (element: Element | null | undefined) =>
  element?.querySelector<HTMLElement>(FOCUSABLE) ?? null;

type UploadTileProps = {
  upload: Upload;
  /** Takes focus when a removed tile leaves no neighbour to move on to. */
  fallbackFocusRef: RefObject<HTMLElement | null>;
};

/** A file of this tab that the server list does not show yet. */
export function UploadTile({ upload, fallbackFocusRef }: UploadTileProps) {
  const { t } = useTranslation('workspace');
  const { t: tJobs } = useTranslation('jobs');
  const { t: tAssets } = useTranslation('assets');
  const dispatch = useAppDispatch();
  const nameId = useId();

  const status = (() => {
    switch (upload.phase) {
      case 'uploading':
        return (
          <Progress
            label={t('stage.uploading')}
            value={upload.progress}
            aria-describedby={nameId}
          />
        );
      case 'creating':
        return <Badge tone="progress">{t('stage.creating')}</Badge>;
      case 'waiting':
        return (
          <>
            <Badge tone="warning">
              {t(upload.reason === 'rateLimited' ? 'stage.waitingRateLimit' : 'stage.waitingQueue')}
            </Badge>
            <Countdown until={upload.retryAt} />
          </>
        );
      case 'submitted':
        return <Badge tone={STATUS_TONE.queued}>{tJobs(STATUS_LABEL_KEY.queued)}</Badge>;
      case 'failed':
        return (
          <>
            <Badge tone="danger">{t('stage.failed')}</Badge>
            <p className={styles.problem}>{t(PROBLEM_KEY[upload.problem])}</p>
            <Button
              size="sm"
              variant="quiet"
              aria-describedby={nameId}
              onClick={(event) => {
                // The button leaves with its tile; a neighbour carries on, then the search.
                const item = event.currentTarget.closest('li');
                const next =
                  firstFocusable(item?.nextElementSibling) ??
                  firstFocusable(item?.previousElementSibling) ??
                  fallbackFocusRef.current;
                next?.focus();
                dispatch(dismissUpload({ id: upload.id, previewUrl: upload.previewUrl }));
              }}
            >
              {tAssets('upload.remove')}
            </Button>
          </>
        );
    }
  })();

  return (
    <Card className={styles.tile}>
      <span className={styles.frame}>
        {upload.kind === 'image' ? (
          <img className={styles.image} src={upload.previewUrl} alt="" />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            ▶
          </span>
        )}
      </span>
      <span id={nameId} className={styles.name} title={upload.fileName}>
        {upload.fileName}
      </span>
      <span className={styles.meta}>{status}</span>
    </Card>
  );
}
