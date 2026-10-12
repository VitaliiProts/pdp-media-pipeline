import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RedriveButton } from '../../../features/jobs';
import {
  DeliveryList,
  problemOf,
  ProblemText,
  useListWebhooksQuery,
  WEBHOOK_MAX_ENDPOINTS,
  WebhookForm,
  WebhookList,
} from '../../../features/webhooks';
import styles from './WebhooksView.module.css';

export function WebhooksView() {
  const { t } = useTranslation('webhooks');
  const webhooks = useListWebhooksQuery();
  const [picked, setPicked] = useState<string | null>(null);
  const items = webhooks.data?.items ?? [];
  // Falls back to the first endpoint, also after the picked one was deleted.
  const selected = items.find((w) => w.id === picked) ?? items[0] ?? null;
  const problem = problemOf(webhooks.error);

  const renderEndpoints = () => {
    if (webhooks.isLoading) return <p className={styles.message}>{t('list.loading')}</p>;
    if (!webhooks.data) {
      return (
        <div className={styles.message}>
          {problem && <ProblemText problem={problem} />}
          <button type="button" className={styles.retry} onClick={() => void webhooks.refetch()}>
            {t('list.retry')}
          </button>
        </div>
      );
    }
    if (items.length === 0) return <p className={styles.message}>{t('list.empty')}</p>;
    return <WebhookList webhooks={items} selectedId={selected?.id ?? null} onSelect={setPicked} />;
  };

  return (
    <div className={styles.view}>
      <aside className={styles.side}>
        <WebhookForm
          disabled={items.length >= WEBHOOK_MAX_ENDPOINTS}
          onCreated={(id) => setPicked(id)}
        />
        <section className={styles.section} aria-labelledby="endpoints-title">
          <h2 id="endpoints-title" className={styles.title}>
            {t('list.title')}
          </h2>
          {renderEndpoints()}
        </section>
      </aside>

      <section className={styles.section} aria-labelledby="deliveries-title">
        <h2 id="deliveries-title" className={styles.title}>
          {t('deliveries.title')}
        </h2>
        {selected ? (
          <>
            <p className={styles.lead}>{t('deliveries.lead', { url: selected.url })}</p>
            <DeliveryList
              key={selected.id}
              endpointId={selected.id}
              renderAction={(delivery) =>
                delivery.status === 'dead' ? <RedriveButton jobId={delivery.id} /> : null
              }
            />
          </>
        ) : (
          <p className={styles.message}>{t('deliveries.none')}</p>
        )}
      </section>
    </div>
  );
}
