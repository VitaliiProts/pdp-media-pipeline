import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetRendition } from '../../../features/assets';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import styles from './AssetPage.module.css';

type VideoPlayerProps = {
  name: string;
  originalUrl: string;
  /** Best first. Without any, the original plays. */
  renditions: readonly AssetRendition[];
  poster: string | null;
};

export function VideoPlayer({ name, originalUrl, renditions, poster }: VideoPlayerProps) {
  const { t } = useTranslation('assets');
  const qualityName = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const current = renditions.find((r) => r.rendition === chosen) ?? renditions[0];
  const src = current?.url ?? originalUrl;

  return (
    <div className={styles.player}>
      {failedSrc === src ? (
        <div className={styles.unplayable}>
          {poster && <img className={styles.original} src={poster} alt="" />}
          <p>{t(current ? 'player.failed' : 'player.unsupported')}</p>
        </div>
      ) : (
        <video
          key={src}
          className={styles.original}
          src={src}
          poster={poster ?? undefined}
          controls
          preload="metadata"
          aria-label={t('player.label', { name })}
          onError={() => setFailedSrc(src)}
        />
      )}
      {renditions.length > 1 && (
        <ChoiceGroup legend={t('player.quality')} className={styles.quality}>
          {renditions.map((rendition) => (
            <Radio
              key={rendition.rendition}
              name={qualityName}
              label={rendition.rendition}
              checked={rendition === current}
              onChange={() => setChosen(rendition.rendition)}
            />
          ))}
        </ChoiceGroup>
      )}
    </div>
  );
}
