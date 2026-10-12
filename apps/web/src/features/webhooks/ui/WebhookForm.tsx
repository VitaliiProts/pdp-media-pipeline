import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateWebhookMutation } from '../api/webhooks-api';
import { problemOf } from '../model/problem';
import { WEBHOOK_EVENTS, type WebhookEvent } from '../model/types';
import { EVENT_LABEL_KEY } from './labels';
import { ProblemText } from './ProblemText';
import styles from './Webhooks.module.css';

type WebhookFormProps = { disabled: boolean; onCreated: (id: string) => void };

export function WebhookForm({ disabled, onCreated }: WebhookFormProps) {
  const { t } = useTranslation('webhooks');
  const [create, { data: created, error, isLoading, reset }] = useCreateWebhookMutation();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<readonly WebhookEvent[]>(WEBHOOK_EVENTS);
  const urlId = useId();
  const canSubmit = !disabled && !isLoading && url.trim().length > 0 && events.length > 0;
  const problem = problemOf(error);

  const toggle = (event: WebhookEvent) =>
    setEvents((current) =>
      current.includes(event) ? current.filter((e) => e !== event) : [...current, event],
    );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const result = await create({ url: url.trim(), events });
    if (result.data) {
      setUrl('');
      onCreated(result.data.id);
    }
  };

  return (
    <div className={styles.card}>
      <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
        <h3 className={styles.cardTitle}>{t('form.title')}</h3>
        <label className={styles.label} htmlFor={urlId}>
          {t('form.url')}
        </label>
        <input
          id={urlId}
          className={styles.input}
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="https://example.com/hooks/pdp"
          value={url}
          disabled={disabled}
          aria-invalid={problem?.key === 'problem.invalid'}
          onChange={(e) => setUrl(e.target.value)}
        />

        <fieldset className={styles.events} disabled={disabled}>
          <legend className={styles.label}>{t('form.events')}</legend>
          {WEBHOOK_EVENTS.map((name) => (
            <label key={name} className={styles.event}>
              <input
                type="checkbox"
                checked={events.includes(name)}
                onChange={() => toggle(name)}
              />
              <span>{t(EVENT_LABEL_KEY[name])}</span>
              <code className={styles.eventName}>{name}</code>
            </label>
          ))}
          {events.length === 0 && <p className={styles.warning}>{t('form.eventsRequired')}</p>}
        </fieldset>

        {disabled && <p className={styles.hint}>{t('form.limit')}</p>}
        {problem && <ProblemText problem={problem} />}

        <button type="submit" className={styles.submit} disabled={!canSubmit}>
          {isLoading ? t('form.pending') : t('form.submit')}
        </button>
      </form>

      {created && (
        <div className={styles.secret} role="status">
          <p className={styles.secretTitle}>{t('secret.title')}</p>
          <p className={styles.hint}>{t('secret.hint')}</p>
          <code className={styles.secretValue}>{created.secret}</code>
          <button type="button" className={styles.quiet} onClick={reset}>
            {t('secret.done')}
          </button>
        </div>
      )}
    </div>
  );
}
