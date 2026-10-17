import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../../../shared/ui/skeleton/Skeleton';
import { ErrorState } from '../../../shared/ui/state/ErrorState';
import { useListApiKeysQuery } from '../api/api-keys-api';
import { API_KEY_MAX_PER_USER, type CreatedApiKey } from '../model/types';
import styles from './ApiKeys.module.css';
import { CreateKeyForm } from './CreateKeyForm';
import { NewKeyDialog } from './NewKeyDialog';
import { RevokeKeyButton } from './RevokeKeyButton';

type ApiKeysSectionProps = {
  /** Runs once a revoked key has left the list, taking the focused row with it. */
  onRevoked: () => void;
};

export function ApiKeysSection({ onRevoked }: ApiKeysSectionProps) {
  const { t, i18n } = useTranslation('apiKeys');
  const { t: tShell } = useTranslation('shell');
  const keys = useListApiKeysQuery();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const items = keys.data?.items ?? [];
  const revokedId = useRef<string | null>(null);

  useEffect(() => {
    const id = revokedId.current;
    if (id === null || keys.data?.items.some((key) => key.id === id)) return;
    revokedId.current = null;
    onRevoked();
  }, [keys.data, onRevoked]);

  const list = (() => {
    if (keys.isLoading) {
      return (
        <div role="status" aria-busy="true" aria-label={t('list.loading')}>
          <Skeleton height="3rem" />
        </div>
      );
    }
    if (keys.isError && !keys.data) {
      return (
        <ErrorState
          title={t('list.errorTitle')}
          headingLevel={3}
          retry={{ label: tShell('retry'), onRetry: () => void keys.refetch() }}
        >
          <p>{t('list.error')}</p>
        </ErrorState>
      );
    }
    if (items.length === 0) return <p className={styles.quiet}>{t('list.empty')}</p>;
    return (
      <ul className={styles.keys}>
        {items.map((key) => (
          <li key={key.id} className={styles.key}>
            <span className={styles.keyName}>{key.name}</span>
            <code className={styles.prefix}>{`${key.prefix}…`}</code>
            <span className={styles.quiet}>
              {t('list.created', { date: date.format(new Date(key.createdAt)) })}
            </span>
            <span className={styles.quiet}>
              {key.lastUsedAt
                ? t('list.lastUsed', { date: date.format(new Date(key.lastUsedAt)) })
                : t('list.neverUsed')}
            </span>
            <span className={styles.keyAction}>
              <RevokeKeyButton
                apiKey={key}
                onRevoked={(id) => {
                  revokedId.current = id;
                }}
              />
            </span>
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div className={styles.stack}>
      {list}
      <CreateKeyForm atLimit={items.length >= API_KEY_MAX_PER_USER} onCreated={setCreated} />
      <NewKeyDialog apiKey={created} onClose={() => setCreated(null)} />
    </div>
  );
}
