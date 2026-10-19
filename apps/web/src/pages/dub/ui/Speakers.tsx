import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { type AssetDub } from '../../../features/assets';
import {
  DUB_TARGET_LANGUAGES,
  type SpeakerGender,
  useStartDubMutation,
} from '../../../features/upload';
import { errorCodeOf } from '../../../shared/api/http';
import { formatDuration } from '../../../shared/lib/format-duration';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Select } from '../../../shared/ui/select/Select';
import { type DubRequest } from '../model/dub-job';
import { type SpeakerChoice, VOICES, choiceOf, overridesOf, withGender } from '../model/speakers';
import styles from './DubPage.module.css';

const GENDERS: readonly SpeakerGender[] = ['male', 'female'];

type SpeakersProps = {
  dub: AssetDub;
  /** The dub whose recognition the next one reuses. */
  jobId: string;
  request: DubRequest;
  file: { assetId: string; sourceKey: string };
};

export function Speakers({ dub, jobId, request, file }: SpeakersProps) {
  const { t } = useTranslation('dub');
  const titleId = useId();
  const navigate = useNavigate();
  const [startDub, started] = useStartDubMutation();
  const [choices, setChoices] = useState<Record<string, SpeakerChoice>>(() =>
    Object.fromEntries(dub.speakers.map((speaker) => [speaker.id, choiceOf(speaker)])),
  );
  const overrides = overridesOf(dub.speakers, choices);
  const changed = Object.keys(overrides).length > 0;
  const target = DUB_TARGET_LANGUAGES.find((code) => code === request.targetLanguage);

  const choose = (id: string, next: SpeakerChoice) =>
    setChoices((current) => ({ ...current, [id]: next }));

  const redub = async () => {
    if (!target || !changed) return;
    const result = await startDub({
      assetId: file.assetId,
      sourceKey: file.sourceKey,
      targetLanguage: target,
      sourceLanguage: request.sourceLanguage,
      speakers: overrides,
      reuseOf: jobId,
    });
    if ('data' in result && result.data) {
      void navigate(`/library/${file.assetId}/dubs/${result.data.jobId}`);
    }
  };

  return (
    <section className={styles.speakers} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.subheading}>
        {t('speakers.title')}
      </h2>
      {dub.speakers.length === 0 ? (
        <p className={styles.quiet}>{t('speakers.empty')}</p>
      ) : (
        <>
          <ul className={styles.speakerList}>
            {dub.speakers.map((speaker) => {
              const choice = choices[speaker.id] ?? choiceOf(speaker);
              const name = t('transcript.speakerName', { id: speaker.id });
              const sureness = Math.round(
                100 *
                  (speaker.gender === 'male'
                    ? speaker.maleProbability
                    : 1 - speaker.maleProbability),
              );
              return (
                <li key={speaker.id} className={styles.speaker}>
                  <p className={styles.speakerName}>
                    <strong>{name}</strong>{' '}
                    <span className={styles.quiet}>
                      {t('speakers.found', {
                        length: formatDuration(speaker.seconds),
                        gender: t(`speakers.gender.${speaker.gender}`),
                        percent: sureness,
                      })}
                    </span>
                  </p>
                  <div className={styles.speakerFields}>
                    <Field label={t('speakers.genderOf', { name })}>
                      {(control) => (
                        <Select
                          {...control}
                          value={choice.gender}
                          onChange={(event) =>
                            choose(
                              speaker.id,
                              withGender(choice, event.target.value === 'male' ? 'male' : 'female'),
                            )
                          }
                        >
                          {GENDERS.map((gender) => (
                            <option key={gender} value={gender}>
                              {t(`speakers.gender.${gender}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('speakers.voiceOf', { name })}>
                      {(control) => (
                        <Select
                          {...control}
                          value={choice.voice}
                          onChange={(event) => {
                            const voice = VOICES[choice.gender].find(
                              (v) => v === event.target.value,
                            );
                            if (voice) choose(speaker.id, { ...choice, voice });
                          }}
                        >
                          {VOICES[choice.gender].map((voice, i) => (
                            <option key={voice} value={voice}>
                              {t('speakers.voice', { number: i + 1 })}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={styles.quiet}>{t('speakers.note')}</p>
          {started.isError && (
            <p className={styles.problem} role="alert">
              {errorCodeOf(started.error) === 'DUB_QUOTA_EXCEEDED'
                ? t('speakers.overQuota')
                : t('speakers.failed')}
            </p>
          )}
          {target && (
            <div className={styles.actions}>
              <Button
                variant="primary"
                disabled={!changed}
                isBusy={started.isLoading}
                onClick={() => void redub()}
              >
                {t('speakers.redub')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
