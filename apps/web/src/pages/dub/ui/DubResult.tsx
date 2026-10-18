import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetDetails, type AssetDub, playableOf } from '../../../features/assets';
import { formatBytes } from '../../../shared/lib/format-bytes';
import { formatDuration } from '../../../shared/lib/format-duration';
import { languageName } from '../../../shared/lib/language-name';
import { buttonClass } from '../../../shared/ui/button/Button';
import { type DubRequest } from '../model/dub-job';
import { DubPlayer } from './DubPlayer';
import styles from './DubPage.module.css';

type DubResultProps = {
  asset: AssetDetails;
  name: string;
  dub: AssetDub;
  request: DubRequest;
};

// Browsers ignore `download` on cross-origin links; the signed URL's Content-Disposition names the file.
export function DubResult({ asset, name, dub, request }: DubResultProps) {
  const { t, i18n } = useTranslation('dub');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, setTime] = useState(0);
  const original = playableOf(asset.jobs).renditions[0]?.url ?? asset.originalUrl;
  const sourceName = languageName(dub.sourceLanguage, i18n.language);
  const language = languageName(dub.targetLanguage, i18n.language);

  return (
    <div className={styles.result}>
      <div className={styles.main}>
        <DubPlayer
          name={name}
          originalUrl={original}
          dub={dub}
          videoRef={videoRef}
          onTime={setTime}
        />
        <div className={styles.actions}>
          <a className={buttonClass()} href={dub.video.downloadUrl} download>
            {t('result.downloadVideo', { size: formatBytes(dub.video.bytes, i18n.language) })}
          </a>
          <a className={buttonClass()} href={dub.subtitles.downloadUrl} download>
            {t('result.downloadSubtitles')}
          </a>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>{t('result.target')}</dt>
            <dd>{language}</dd>
          </div>
          <div>
            <dt>{t('result.source')}</dt>
            <dd>
              {request.sourceLanguage === 'auto'
                ? t('result.sourceDetected', { language: sourceName })
                : sourceName}
            </dd>
          </div>
          <div>
            <dt>{t('result.duration')}</dt>
            <dd>{formatDuration(dub.durationSeconds)}</dd>
          </div>
          <div>
            <dt>{t('result.phrases')}</dt>
            <dd>
              {t('result.phrasesValue', {
                count: dub.stats.phrases,
                sped: dub.stats.sped,
                refitted: dub.stats.refitted,
                overflowed: dub.stats.overflowed,
              })}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
