import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetJob } from '../../../features/assets';
import { IMAGE_PRESETS, PRESET_LABEL_KEY } from '../../../features/upload';
import { formatBytes } from '../../../shared/lib/format-bytes';
import { formatDuration } from '../../../shared/lib/format-duration';
import { buttonClass } from '../../../shared/ui/button/Button';
import { formatOf, framesOf, type Version, versionsOf } from '../model/versions';
import styles from './AssetPage.module.css';

// Browsers ignore `download` on cross-origin links; the signed URL's Content-Disposition names the file.
export function VersionList({ jobs }: { jobs: readonly AssetJob[] }) {
  const { t, i18n } = useTranslation('assets');
  const { t: tUpload } = useTranslation('upload');
  const framesHeadingId = useId();
  const versions = versionsOf(jobs);
  const frames = framesOf(jobs);

  const labelOf = (version: Version): string => {
    if (version.kind === 'rendition') return version.rendition;
    if (version.kind === 'preview') return t('versions.preview');
    const preset = IMAGE_PRESETS.find((p) => p.name === version.preset);
    const name = preset ? tUpload(PRESET_LABEL_KEY[preset.name]) : version.preset;
    return t('versions.imageLabel', { name, width: version.width });
  };

  if (versions.length === 0 && frames.length === 0) {
    return <p className={styles.quiet}>{t('versions.none')}</p>;
  }

  return (
    <div className={styles.versionsPanel}>
      <ul className={styles.versions}>
        {versions.map((version) => {
          const label = labelOf(version);
          return (
            <li key={version.id} className={styles.version}>
              {version.kind === 'rendition' ? (
                <span className={styles.thumbPlaceholder} aria-hidden="true">
                  ▶
                </span>
              ) : (
                <img className={styles.thumb} src={version.url} alt="" loading="lazy" />
              )}
              <span className={styles.versionName}>{label}</span>
              <span>
                {t('versions.dimensions', { width: version.width, height: version.height })}
              </span>
              <span>{formatBytes(version.bytes, i18n.language)}</span>
              <span>{formatOf(version.url)}</span>
              <a
                className={buttonClass({ size: 'sm' })}
                href={version.downloadUrl}
                download
                aria-label={t('versions.downloadLabel', { name: label })}
              >
                {t('versions.download')}
              </a>
            </li>
          );
        })}
      </ul>
      {frames.length > 0 && (
        <section aria-labelledby={framesHeadingId}>
          <h3 id={framesHeadingId} className={styles.subheading}>
            {t('versions.frames')}
          </h3>
          <ul className={styles.frames}>
            {frames.map((frame) => (
              <li key={frame.url}>
                <a
                  href={frame.downloadUrl}
                  download
                  className={styles.frame}
                  aria-label={t('versions.frameLabel', { time: formatDuration(frame.atSeconds) })}
                >
                  <img
                    src={frame.url}
                    width={frame.width}
                    height={frame.height}
                    alt=""
                    loading="lazy"
                  />
                  <span aria-hidden="true">{formatDuration(frame.atSeconds)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
