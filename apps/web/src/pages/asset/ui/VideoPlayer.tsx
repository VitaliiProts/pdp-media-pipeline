import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetRendition } from '../../../features/assets';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import styles from './AssetPage.module.css';

const ORIGINAL = 'original';

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
  const current = renditions.find((r) => r.rendition === chosen) ?? renditions[0];
  const sourceId = current?.rendition ?? ORIGINAL;
  const freshUrl = current?.url ?? originalUrl;
  // Every fetch signs the links anew; a new `src` would restart playback, so a source keeps its first link.
  const [source, setSource] = useState({ id: sourceId, url: freshUrl });
  const [failedId, setFailedId] = useState<string | null>(null);
  if (source.id !== sourceId) setSource({ id: sourceId, url: freshUrl });
  const src = source.id === sourceId ? source.url : freshUrl;

  const handleError = () => {
    // An expired link fails too; a newer one gets a try before the source counts as unplayable.
    if (src !== freshUrl) setSource({ id: sourceId, url: freshUrl });
    else setFailedId(sourceId);
  };

  return (
    <div className={styles.player}>
      {failedId === sourceId ? (
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
          onError={handleError}
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
