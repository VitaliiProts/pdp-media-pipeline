import { useTranslation } from 'react-i18next';
import styles from './LanguageSwitch.module.css';

const LANGUAGES = [
  { code: 'uk', label: 'UA' },
  { code: 'en', label: 'EN' },
] as const;

export function LanguageSwitch() {
  const { t, i18n } = useTranslation('shell');

  return (
    <div className={styles.switch} role="group" aria-label={t('language')}>
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          lang={code}
          className={styles.option}
          aria-pressed={i18n.resolvedLanguage === code}
          onClick={() => void i18n.changeLanguage(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
