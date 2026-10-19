import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../../shared/lib/format-duration';
import { languageName } from '../../../shared/lib/language-name';
import { Button } from '../../../shared/ui/button/Button';
import { useGetDubQuotaQuery } from '../api/dub-api';
import { checkFile, mediaKindOf } from '../lib/validate-file';
import { videoDurationOf } from '../lib/video-duration';
import {
  AUTO_LANGUAGE,
  type DubBlock,
  type DubSettings,
  isSameLanguage,
  uploadDubBlocksOf,
} from '../model/dub';
import styles from './Dub.module.css';
import { DubQuotaNote } from './DubQuotaNote';

const BLOCK_KEY = {
  tooLong: 'dub.confirm.tooLong',
  overQuota: 'dub.confirm.overQuota',
} as const satisfies Record<DubBlock, string>;

type DubConfirmProps = {
  files: readonly File[];
  settings: DubSettings;
  onBack: () => void;
  onStart: () => void;
};

/** The videos about to be dubbed, with their length and whether the month's time covers them. */
export function DubConfirm({ files, settings, onBack, onStart }: DubConfirmProps) {
  const { t, i18n } = useTranslation('upload');
  const headingId = useId();
  const videos = useMemo(
    () => files.filter((file) => mediaKindOf(file.type) === 'video' && checkFile(file) === null),
    [files],
  );
  const [durations, setDurations] = useState<(number | null)[] | null>(null);
  const quota = useGetDubQuotaQuery();

  useEffect(() => {
    let live = true;
    void Promise.all(videos.map(videoDurationOf)).then((measured) => {
      if (live) setDurations(measured);
    });
    return () => {
      live = false;
    };
  }, [videos]);

  const blocks = durations && quota.data ? uploadDubBlocksOf(durations, quota.data) : null;
  const canStart = blocks !== null && !blocks.some(Boolean) && !isSameLanguage(settings);
  const source =
    settings.sourceLanguage === AUTO_LANGUAGE
      ? t('dub.confirm.detected')
      : languageName(settings.sourceLanguage, i18n.language);

  return (
    <section className={styles.confirm} aria-labelledby={headingId}>
      <h3 id={headingId}>{t('dub.confirm.title', { count: videos.length })}</h3>
      <p className={styles.note}>
        {t('dub.confirm.summary', {
          target: languageName(settings.targetLanguage, i18n.language),
          source,
        })}
      </p>
      <ul className={styles.files}>
        {videos.map((file, i) => {
          const seconds = durations?.[i];
          const block = blocks?.[i];
          return (
            <li key={`${file.name}:${i}`} className={styles.file}>
              <span className={styles.fileName}>{file.name}</span>
              <span>
                {seconds === undefined
                  ? t('dub.confirm.measuring')
                  : seconds === null
                    ? t('dub.confirm.unknownDuration')
                    : formatDuration(seconds)}
              </span>
              {block && (
                <p className={styles.fileProblem}>
                  {t(BLOCK_KEY[block], {
                    max: formatDuration(quota.data?.maxVideoSeconds ?? 0),
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <DubQuotaNote />
      {quota.data && (
        <p className={styles.note}>
          {t('dub.quota.unmeasured', { max: formatDuration(quota.data.maxVideoSeconds) })}
        </p>
      )}
      <p className={styles.note}>{t('dub.privacy')}</p>
      <div className={styles.buttons}>
        <Button variant="primary" disabled={!canStart} onClick={onStart}>
          {t('dub.confirm.start')}
        </Button>
        <Button onClick={onBack}>{t('dub.confirm.back')}</Button>
      </div>
    </section>
  );
}
