import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type JobResult, type VideoFrame } from '../../../features/jobs';
import { IMAGE_PRESETS, type ImagePreset, PRESET_LABEL_KEY } from '../../../features/upload';
import { formatBytes } from '../../../shared/lib/format-bytes';
import { type ItemDescription } from '../model/describe-item';
import { formatTimecode } from '../model/timecode';
import { Countdown } from './Countdown';
import styles from './SlideMount.module.css';

type SlideMountProps = {
  title: string;
  previewUrl: string | null;
  description: ItemDescription;
  attempts: number;
  results: readonly JobResult[];
  frames: readonly VideoFrame[];
  onDismiss?: () => void;
  /** Extra controls under the caption, e.g. a redrive button. */
  action?: ReactNode;
};

const isPreset = (value: string): value is ImagePreset =>
  IMAGE_PRESETS.some((preset) => preset.name === value);

export function SlideMount({
  title,
  previewUrl,
  description,
  attempts,
  results,
  frames,
  onDismiss,
  action,
}: SlideMountProps) {
  const { t, i18n } = useTranslation(['workspace', 'jobs', 'upload']);
  const { tone, label, progress, retryAt, problem } = description;
  // A file the browser cannot decode would otherwise show a broken-image icon.
  const [undecodable, setUndecodable] = useState<string | null>(null);

  return (
    <article className={styles.mount} data-tone={tone}>
      <div className={styles.window}>
        {previewUrl !== null && previewUrl !== undecodable ? (
          <img
            className={styles.image}
            src={previewUrl}
            alt=""
            loading="lazy"
            onError={() => setUndecodable(previewUrl)}
          />
        ) : (
          <div className={styles.blank} aria-hidden="true" />
        )}
        {progress !== null && (
          <progress className={styles.progress} value={progress} max={1}>
            {Math.round(progress * 100)}%
          </progress>
        )}
      </div>

      <div className={styles.caption}>
        <h3 className={styles.title} title={title}>
          {title}
        </h3>
        <p className={styles.status}>
          <span className={styles.dot} aria-hidden="true" />
          {t(label.key, { ns: label.ns })}
          {attempts > 1 && (
            <span className={styles.attempts}>{t('attempt', { count: attempts })}</span>
          )}
          {retryAt !== null && <Countdown until={retryAt} className={styles.attempts} />}
        </p>

        {problem && (
          <p className={styles.problem}>
            {t(problem.key)}
            {problem.detail && <span className={styles.detail}>{problem.detail}</span>}
          </p>
        )}

        {results.length > 0 && (
          <ul className={styles.results} aria-label={t('results')}>
            {results.map((result) => (
              <li key={result.preset}>
                <a className={styles.result} href={result.url} target="_blank" rel="noreferrer">
                  <span>
                    {isPreset(result.preset)
                      ? t(PRESET_LABEL_KEY[result.preset], { ns: 'upload' })
                      : result.preset}
                  </span>
                  <span className={styles.numbers}>
                    {t('dimensions', { width: result.width, height: result.height })}
                  </span>
                  <span className={styles.numbers}>{formatBytes(result.bytes, i18n.language)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {frames.length > 0 && (
          <ul className={styles.frames} aria-label={t('frames')}>
            {frames.map((frame) => {
              const frameLabel = t('frameAt', { time: formatTimecode(frame.atSeconds) });
              return (
                <li key={frame.url}>
                  <a
                    className={styles.frame}
                    href={frame.url}
                    target="_blank"
                    rel="noreferrer"
                    title={frameLabel}
                  >
                    <img src={frame.url} alt={frameLabel} loading="lazy" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {action}

        {onDismiss && (
          <button type="button" className={styles.dismiss} onClick={onDismiss}>
            {t('dismiss')}
          </button>
        )}
      </div>
    </article>
  );
}
