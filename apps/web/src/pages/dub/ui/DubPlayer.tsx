import { type RefObject, type SyntheticEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetDub } from '../../../features/assets';
import { languageName } from '../../../shared/lib/language-name';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import { useSubtitlesUrl } from '../lib/use-subtitles-url';
import styles from './DubPage.module.css';

type Track = 'dubbed' | 'original';

/** Every fetch signs links anew; a new `src` restarts playback, so a source keeps its first link until it fails. */
function useStableUrl(fresh: string) {
  const [url, setUrl] = useState(fresh);
  const refresh = (): boolean => {
    if (url === fresh) return false;
    setUrl(fresh);
    return true;
  };
  return { url, refresh };
}

type DubPlayerProps = {
  name: string;
  /** The original or its best rendition: browsers cannot pick an audio track of an MP4. */
  originalUrl: string;
  dub: AssetDub;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTime: (seconds: number) => void;
};

export function DubPlayer({ name, originalUrl, dub, videoRef, onTime }: DubPlayerProps) {
  const { t, i18n } = useTranslation('dub');
  const groupName = useId();
  const [track, setTrack] = useState<Track>('dubbed');
  const [failed, setFailed] = useState<Track | null>(null);
  const original = useStableUrl(originalUrl);
  const dubbed = useStableUrl(dub.video.url);
  const subtitles = useSubtitlesUrl(dub.subtitles.url);
  /** Where the other source was, so switching carries on from the same moment. */
  const resume = useRef<{ time: number; playing: boolean } | null>(null);
  const source = track === 'dubbed' ? dubbed : original;
  const language = languageName(dub.targetLanguage, i18n.language);

  const remember = () => {
    const video = videoRef.current;
    resume.current = video ? { time: video.currentTime, playing: !video.paused } : null;
  };

  const choose = (next: Track) => {
    remember();
    setTrack(next);
  };

  const handleLoaded = (event: SyntheticEvent<HTMLVideoElement>) => {
    const at = resume.current;
    resume.current = null;
    if (!at) return;
    const video = event.currentTarget;
    video.currentTime = at.time;
    if (at.playing) void video.play().catch(() => undefined);
  };

  const handleError = () => {
    // An expired link fails too; a newer one gets a try before the source counts as unplayable.
    remember();
    if (!source.refresh()) setFailed(track);
  };

  return (
    <div className={styles.player}>
      {failed === track ? (
        <p className={styles.problem}>{t('result.unplayable')}</p>
      ) : (
        <video
          key={`${track}:${source.url}`}
          ref={videoRef}
          className={styles.video}
          src={source.url}
          controls
          preload="metadata"
          aria-label={t('result.player', { name })}
          onLoadedMetadata={handleLoaded}
          onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
          onError={handleError}
        >
          {subtitles && (
            <track
              kind="subtitles"
              src={subtitles}
              srcLang={dub.targetLanguage}
              label={t('result.subtitles', { language })}
            />
          )}
        </video>
      )}
      <ChoiceGroup legend={t('result.track')} className={styles.tracks}>
        <Radio
          name={groupName}
          label={t('result.dubbed', { language })}
          checked={track === 'dubbed'}
          onChange={() => choose('dubbed')}
        />
        <Radio
          name={groupName}
          label={t('result.original')}
          checked={track === 'original'}
          onChange={() => choose('original')}
        />
      </ChoiceGroup>
    </div>
  );
}
