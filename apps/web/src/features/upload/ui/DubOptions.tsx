import { useTranslation } from 'react-i18next';
import { languageName } from '../../../shared/lib/language-name';
import { Field } from '../../../shared/ui/field/Field';
import { Select } from '../../../shared/ui/select/Select';
import {
  AUTO_LANGUAGE,
  DUB_SOURCE_LANGUAGES,
  DUB_TARGET_LANGUAGES,
  type DubSettings,
  isSameLanguage,
} from '../model/dub';
import styles from './Dub.module.css';

type DubOptionsProps = { value: DubSettings; onChange: (next: DubSettings) => void };

/** Languages of a dub, and what is sent where; the caller decides when to start. */
export function DubOptions({ value, onChange }: DubOptionsProps) {
  const { t, i18n } = useTranslation('upload');
  const name = (code: string) => languageName(code, i18n.language);

  return (
    <div className={styles.options}>
      <Field label={t('dub.target')}>
        {(control) => (
          <Select
            {...control}
            value={value.targetLanguage}
            onChange={(event) => {
              const target = DUB_TARGET_LANGUAGES.find((code) => code === event.target.value);
              if (target) onChange({ ...value, targetLanguage: target });
            }}
          >
            {DUB_TARGET_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {name(code)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t('dub.source')}
        error={isSameLanguage(value) ? t('dub.sameLanguage') : undefined}
      >
        {(control) => (
          <Select
            {...control}
            value={value.sourceLanguage}
            onChange={(event) => onChange({ ...value, sourceLanguage: event.target.value })}
          >
            <option value={AUTO_LANGUAGE}>{t('dub.auto')}</option>
            {DUB_SOURCE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {name(code)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p className={styles.note}>{t('dub.privacy')}</p>
    </div>
  );
}
