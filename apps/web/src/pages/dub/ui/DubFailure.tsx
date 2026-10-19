import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { DUB_TARGET_LANGUAGES, useStartDubMutation } from '../../../features/upload';
import { Button, buttonClass } from '../../../shared/ui/button/Button';
import { type DubFailure as Failure, type DubRequest } from '../model/dub-job';
import styles from './DubPage.module.css';
import { FAILURE_KEY } from './failure-keys';

/** Worth another go later; the rest would fail the same way. */
const TRANSIENT: readonly Failure[] = ['stt_unavailable', 'translate_unavailable', 'other'];

type DubFailureProps = {
  failure: Failure;
  lastError: string | null;
  request: DubRequest;
  file: { assetId: string; sourceKey: string };
};

export function DubFailure({ failure, lastError, request, file }: DubFailureProps) {
  const { t } = useTranslation('dub');
  const titleId = useId();
  const navigate = useNavigate();
  const [startDub, started] = useStartDubMutation();
  const target = DUB_TARGET_LANGUAGES.find((code) => code === request.targetLanguage);

  const retry = async () => {
    if (!target) return;
    const result = await startDub({
      assetId: file.assetId,
      sourceKey: file.sourceKey,
      targetLanguage: target,
      sourceLanguage: request.sourceLanguage,
    });
    if ('data' in result && result.data) {
      void navigate(`/library/${file.assetId}/dubs/${result.data.jobId}`);
    }
  };

  return (
    <section className={styles.failure} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.subheading}>
        {t('failure.title')}
      </h2>
      <p>{t(FAILURE_KEY[failure])}</p>
      {failure === 'other' && lastError && <p className={styles.quiet}>{lastError}</p>}
      {started.isError && (
        <p className={styles.problem} role="alert">
          {t('failure.retryFailed')}
        </p>
      )}
      <div className={styles.actions}>
        {TRANSIENT.includes(failure) && target && (
          <Button variant="primary" isBusy={started.isLoading} onClick={() => void retry()}>
            {t('failure.retry')}
          </Button>
        )}
        <Link to={`/library/${file.assetId}`} className={buttonClass()}>
          {t('toFile')}
        </Link>
      </div>
    </section>
  );
}
