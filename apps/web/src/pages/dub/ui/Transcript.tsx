import { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetDub } from '../../../features/assets';
import { formatDuration } from '../../../shared/lib/format-duration';
import { languageName } from '../../../shared/lib/language-name';
import { Badge } from '../../../shared/ui/badge/Badge';
import { type PhraseMark, currentRowId, transcriptOf } from '../model/transcript';
import styles from './DubPage.module.css';

type TranscriptProps = {
  dub: AssetDub;
  /** Playback position, for the row being heard. */
  seconds: number;
  onSeek: (seconds: number) => void;
};

export function Transcript({ dub, seconds, onSeek }: TranscriptProps) {
  const { t, i18n } = useTranslation('dub');
  const titleId = useId();
  const rows = useMemo(() => transcriptOf(dub), [dub]);
  const current = currentRowId(rows, seconds);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scroller.current;
    const row = current ? box?.querySelector<HTMLElement>(`[data-row="${current}"]`) : null;
    if (!box || !row) return;
    // Only the transcript scrolls, so the page under the player stays put.
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 0 || top + row.offsetHeight > box.clientHeight) {
      box.scrollTo?.({ top: box.scrollTop + top - box.clientHeight / 3, behavior: 'smooth' });
    }
  }, [current]);

  const markLabel = (mark: PhraseMark, speed: number) =>
    mark === 'sped'
      ? t('transcript.sped', { speed: speed.toLocaleString(i18n.language) })
      : t(`transcript.${mark}`);

  return (
    <section className={styles.transcript} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.subheading}>
        {t('transcript.title')}
      </h2>
      {rows.length === 0 ? (
        <p className={styles.quiet}>{t('transcript.empty')}</p>
      ) : (
        <div ref={scroller} className={styles.scroller}>
          <table className={styles.lines}>
            <thead>
              <tr>
                <th scope="col">{t('transcript.time')}</th>
                <th scope="col">{t('transcript.speaker')}</th>
                <th scope="col">{languageName(dub.sourceLanguage, i18n.language)}</th>
                <th scope="col">{languageName(dub.targetLanguage, i18n.language)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const time = formatDuration(row.start);
                return (
                  <tr
                    key={row.id}
                    data-row={row.id}
                    data-current={row.id === current || undefined}
                    aria-current={row.id === current || undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.seek}
                        aria-label={t('transcript.playFrom', { time })}
                        onClick={() => onSeek(row.start)}
                      >
                        {time}
                      </button>
                    </td>
                    {row.kind === 'phrase' ? (
                      <>
                        <td>{t('transcript.speakerName', { id: row.speaker })}</td>
                        <td>{row.source}</td>
                        <td>
                          {row.target}
                          {row.marks.length > 0 && (
                            <span className={styles.marks}>
                              {row.marks.map((mark) => (
                                <Badge
                                  key={mark}
                                  tone={mark === 'overflowed' ? 'warning' : 'neutral'}
                                  title={t(`transcript.${mark}Hint`)}
                                >
                                  {markLabel(mark, row.speed)}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className={styles.gap}>
                        {t('transcript.unrecognized', { until: formatDuration(row.until) })}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
