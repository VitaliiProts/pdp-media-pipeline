import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpStatusOf } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useRevokeApiKeyMutation } from '../api/api-keys-api';
import { type ApiKey } from '../model/types';
import styles from './ApiKeys.module.css';

type RevokeKeyButtonProps = { apiKey: ApiKey; onRevoked: (id: string) => void };

/** Asks before revoking; `onRevoked` also runs when the key was already gone (404). */
export function RevokeKeyButton({ apiKey, onRevoked }: RevokeKeyButtonProps) {
  const { t } = useTranslation('apiKeys');
  const [revoke, { isLoading }] = useRevokeApiKeyMutation();
  const [isOpen, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = () => {
    setFailed(false);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setFailed(false);
  };

  const confirm = async () => {
    setFailed(false);
    try {
      await revoke(apiKey.id).unwrap();
    } catch (error) {
      if (httpStatusOf(error) !== 404) {
        setFailed(true);
        return;
      }
    }
    close();
    onRevoked(apiKey.id);
  };

  return (
    <>
      <Button
        size="sm"
        variant="quiet"
        aria-label={t('list.revokeLabel', { name: apiKey.name })}
        onClick={open}
      >
        {t('list.revoke')}
      </Button>
      <Dialog
        open={isOpen}
        // Only the gateway's answer says the key is revoked (scripts stop within a minute, as its
        // key cache expires), so the dialog waits for it.
        dismissible={!isLoading}
        onClose={close}
        title={t('revoke.title', { name: apiKey.name })}
        closeLabel={t('revoke.close')}
      >
        <div className={styles.stack}>
          <p className={styles.body}>{t('revoke.body')}</p>
          {failed && (
            <p role="alert" className={styles.problem}>
              {t('revoke.failed')}
            </p>
          )}
          <div className={styles.row}>
            <Button variant="danger" isBusy={isLoading} onClick={() => void confirm()}>
              {t('revoke.confirm')}
            </Button>
            <Button isBusy={isLoading} onClick={close}>
              {t('revoke.cancel')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
