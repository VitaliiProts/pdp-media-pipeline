import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { problemOf } from '../model/problem';
import { type Delivery } from '../model/types';
import { useLiveDeliveries } from '../model/use-live-deliveries';
import { DELIVERY_STATUS_KEY, EVENT_LABEL_KEY } from './labels';
import { ProblemText } from './ProblemText';
import styles from './Webhooks.module.css';

type DeliveryListProps = {
  endpointId: string;
  /** Extra controls per row, e.g. a redrive button for dead deliveries. */
  renderAction?: (delivery: Delivery) => ReactNode;
};

export function DeliveryList({ endpointId, renderAction }: DeliveryListProps) {
  const { t, i18n } = useTranslation('webhooks');
  const deliveries = useLiveDeliveries(endpointId);
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' });
  const problem = problemOf(deliveries.error);

  if (deliveries.isLoading) return <p className={styles.message}>{t('deliveries.loading')}</p>;
  if (!deliveries.data) {
    return (
      <div className={styles.message}>
        {problem && <ProblemText problem={problem} />}
        <button type="button" className={styles.quiet} onClick={() => void deliveries.refetch()}>
          {t('deliveries.retry')}
        </button>
      </div>
    );
  }
  if (deliveries.data.items.length === 0) {
    return <p className={styles.message}>{t('deliveries.empty')}</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('deliveries.event')}</th>
            <th scope="col">{t('deliveries.status')}</th>
            <th scope="col">{t('deliveries.attempts')}</th>
            <th scope="col">{t('deliveries.response')}</th>
            <th scope="col">{t('deliveries.updated')}</th>
            <th scope="col">
              <span className={styles.visuallyHidden}>{t('deliveries.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveries.data.items.map((delivery) => (
            <tr key={delivery.id} data-status={delivery.status}>
              <td>
                {t(EVENT_LABEL_KEY[delivery.event])}
                <code className={styles.ids} title={delivery.messageId}>
                  {delivery.messageId}
                </code>
              </td>
              <td>
                <span className={styles.status}>{t(DELIVERY_STATUS_KEY[delivery.status])}</span>
                {delivery.lastError && delivery.status !== 'succeeded' && (
                  <span className={styles.detail}>{delivery.lastError}</span>
                )}
              </td>
              <td className={styles.number}>{delivery.attempts}</td>
              <td className={styles.number}>{delivery.responseStatus ?? '—'}</td>
              <td className={styles.number}>{time.format(new Date(delivery.updatedAt))}</td>
              <td>{renderAction?.(delivery)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
