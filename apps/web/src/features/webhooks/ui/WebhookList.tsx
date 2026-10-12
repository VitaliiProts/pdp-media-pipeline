import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteWebhookMutation } from '../api/webhooks-api';
import { problemOf } from '../model/problem';
import { type Webhook } from '../model/types';
import { ProblemText } from './ProblemText';
import styles from './Webhooks.module.css';

type WebhookListProps = {
  webhooks: readonly Webhook[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function WebhookList({ webhooks, selectedId, onSelect }: WebhookListProps) {
  const { t, i18n } = useTranslation('webhooks');
  const [remove, { isLoading, error }] = useDeleteWebhookMutation();
  // Deleting drops queued deliveries, so it takes a second click.
  const [confirming, setConfirming] = useState<string | null>(null);
  const problem = problemOf(error);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <>
      <ul className={styles.endpoints}>
        {webhooks.map((webhook) => (
          <li
            key={webhook.id}
            className={styles.endpoint}
            data-selected={webhook.id === selectedId}
          >
            <button
              type="button"
              className={styles.endpointMain}
              aria-pressed={webhook.id === selectedId}
              onClick={() => onSelect(webhook.id)}
            >
              <span className={styles.url}>{webhook.url}</span>
              <span className={styles.meta}>
                {webhook.events.join(', ')} · {date.format(new Date(webhook.createdAt))}
              </span>
            </button>
            {confirming === webhook.id ? (
              <span className={styles.confirm}>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={isLoading}
                  onClick={() => void remove(webhook.id).then(() => setConfirming(null))}
                >
                  {t('list.confirmDelete')}
                </button>
                <button type="button" className={styles.quiet} onClick={() => setConfirming(null)}>
                  {t('list.cancel')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={styles.quiet}
                aria-label={t('list.deleteLabel', { url: webhook.url })}
                onClick={() => setConfirming(webhook.id)}
              >
                {t('list.delete')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {problem && <ProblemText problem={problem} />}
    </>
  );
}
