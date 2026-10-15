import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../../shared/lib/redux';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { apiKeySaved, selectApiKeyWasRejected } from '../model/api-key-slice';
import styles from './ApiKeyForm.module.css';

const SEED_COMMAND = 'docker compose exec metadata node dist/seed-user.js --name dev';

export function ApiKeyForm() {
  const { t } = useTranslation('apiKey');
  const dispatch = useAppDispatch();
  const wasRejected = useAppSelector(selectApiKeyWasRejected);
  const [value, setValue] = useState('');
  const canSubmit = value.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) dispatch(apiKeySaved(value));
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <p className={styles.lead}>{t('lead')}</p>
      <Field
        label={t('label')}
        error={wasRejected ? <span role="alert">{t('rejected')}</span> : undefined}
        hint={
          <>
            {t('hint')} <code className={styles.command}>{SEED_COMMAND}</code>
          </>
        }
      >
        {(control) => (
          <div className={styles.row}>
            <Input
              {...control}
              className={styles.input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="pdp_…"
              // The form remounts after a rejection; without this, focus is left on <body>.
              autoFocus={wasRejected}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <Button variant="primary" type="submit" disabled={!canSubmit}>
              {t('submit')}
            </Button>
          </div>
        )}
      </Field>
    </form>
  );
}
