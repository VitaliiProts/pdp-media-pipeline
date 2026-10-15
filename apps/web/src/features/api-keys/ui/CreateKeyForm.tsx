import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCodeOf } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { useCreateApiKeyMutation } from '../api/api-keys-api';
import { API_KEY_MAX_PER_USER, API_KEY_NAME_MAX_LENGTH, type CreatedApiKey } from '../model/types';
import styles from './ApiKeys.module.css';

type CreateKeyFormProps = { atLimit: boolean; onCreated: (key: CreatedApiKey) => void };

type Failure = 'limit' | 'failed';

export function CreateKeyForm({ atLimit, onCreated }: CreateKeyFormProps) {
  const { t } = useTranslation('apiKeys');
  const [createApiKey, { isLoading }] = useCreateApiKeyMutation();
  const [name, setName] = useState('');
  const [isNameMissing, setNameMissing] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const limitText = t('create.limit', { max: API_KEY_MAX_PER_USER });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameMissing(true);
      inputRef.current?.focus();
      return;
    }
    setNameMissing(false);
    try {
      const request = createApiKey({ name: trimmed });
      const created = await request.unwrap();
      // The store would otherwise keep the key as this mutation's result. The hook's `reset`
      // is the one from before the request started here, and would do nothing.
      request.reset();
      setName('');
      onCreated(created);
    } catch (error) {
      setFailure(errorCodeOf(error) === 'API_KEY_LIMIT_REACHED' ? 'limit' : 'failed');
    }
  };

  return (
    <form className={styles.create} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Field
        label={t('create.name')}
        hint={atLimit ? limitText : t('create.hint', { max: API_KEY_NAME_MAX_LENGTH })}
        error={isNameMissing ? t('create.required') : undefined}
        className={styles.name}
      >
        {(control) => (
          <Input
            {...control}
            ref={inputRef}
            value={name}
            maxLength={API_KEY_NAME_MAX_LENGTH}
            disabled={atLimit}
            onChange={(event) => {
              setName(event.target.value);
              setNameMissing(false);
            }}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" isBusy={isLoading} disabled={atLimit}>
        {t('create.submit')}
      </Button>
      {/* Once the list catches up with the limit, the hint says it instead. */}
      {failure && !(failure === 'limit' && atLimit) && (
        <p role="alert" className={styles.problem}>
          {failure === 'limit' ? limitText : t('create.failed')}
        </p>
      )}
    </form>
  );
}
