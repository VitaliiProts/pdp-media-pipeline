import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RedriveButton } from '../../features/jobs';
import {
  DeliveryList,
  problemOf,
  ProblemText,
  useListWebhooksQuery,
  WEBHOOK_MAX_ENDPOINTS,
  WebhookForm,
  WebhookList,
} from '../../features/webhooks';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { VisuallyHidden } from '../../shared/ui/visually-hidden/VisuallyHidden';
import styles from './WebhooksPage.module.css';

export function WebhooksPage() {
  const { t } = useTranslation('webhooks');
  const { t: tShell } = useTranslation('shell');
  const webhooks = useListWebhooksQuery();
  const [picked, setPicked] = useState<string | null>(null);
  const items = webhooks.data?.items ?? [];
  // Falls back to the first endpoint, also after the picked one was deleted.
  const selected = items.find((w) => w.id === picked) ?? items[0] ?? null;
  const problem = problemOf(webhooks.error);

  const renderEndpoints = () => {
    if (webhooks.isLoading) {
      return (
        <div role="status" aria-busy="true" className={styles.skeleton}>
          <VisuallyHidden>{t('list.loading')}</VisuallyHidden>
          <Skeleton height="3.25rem" />
          <Skeleton height="3.25rem" />
        </div>
      );
    }
    if (!webhooks.data) {
      return (
        <ErrorState
          headingLevel={3}
          title={t('list.errorTitle')}
          retry={{ label: t('list.retry'), onRetry: () => void webhooks.refetch() }}
        >
          {problem && <ProblemText problem={problem} isAlert={false} />}
        </ErrorState>
      );
    }
    if (items.length === 0) {
      return (
        <EmptyState headingLevel={3} title={t('list.empty')}>
          <p>{t('list.emptyBody')}</p>
        </EmptyState>
      );
    }
    return <WebhookList webhooks={items} selectedId={selected?.id ?? null} onSelect={setPicked} />;
  };

  return (
    <>
      <PageHeading>{tShell('nav.webhooks')}</PageHeading>
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
    </>
  );
}
