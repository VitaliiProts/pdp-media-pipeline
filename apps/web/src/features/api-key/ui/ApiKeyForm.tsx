import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../../shared/lib/redux';
import { apiKeySaved, selectApiKeyWasRejected } from '../model/api-key-slice';
import styles from './ApiKeyForm.module.css';

const SEED_COMMAND = 'docker compose exec metadata node dist/seed-user.js --name dev';

export function ApiKeyForm() {
  const { t } = useTranslation('apiKey');
  const dispatch = useAppDispatch();
  const wasRejected = useAppSelector(selectApiKeyWasRejected);
  const [value, setValue] = useState('');
  const inputId = useId();
  const hintId = useId();
  const canSubmit = value.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) dispatch(apiKeySaved(value));
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} aria-describedby={hintId}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('lead')}</p>

      <label className={styles.label} htmlFor={inputId}>
        {t('label')}
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          className={styles.input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="pdp_…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={wasRejected}
        />
        <button className={styles.submit} type="submit" disabled={!canSubmit}>
          {t('submit')}
        </button>
      </div>
      {wasRejected && (
        <p className={styles.error} role="alert">
          {t('rejected')}
        </p>
      )}

      <div id={hintId} className={styles.hint}>
        <p>{t('hint')}</p>
        <code className={styles.command}>{SEED_COMMAND}</code>
      </div>
    </form>
  );
}
