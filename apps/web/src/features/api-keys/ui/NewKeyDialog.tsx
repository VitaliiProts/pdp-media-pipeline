import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { type CreatedApiKey } from '../model/types';
import styles from './ApiKeys.module.css';

type CopyState = 'idle' | 'copied' | 'manual';

type NewKeyDialogProps = { apiKey: CreatedApiKey | null; onClose: () => void };

/** The only place the full key is ever shown; closing the dialog drops it from memory. */
export function NewKeyDialog({ apiKey, onClose }: NewKeyDialogProps) {
  const { t } = useTranslation('apiKeys');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const key = apiKey?.key ?? '';

  const close = () => {
    setCopyState('idle');
    onClose();
  };

  const copy = async () => {
    try {
      // Missing outside secure contexts (plain http on a LAN address): that throws too.
      await navigator.clipboard.writeText(key);
      setCopyState('copied');
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyState('manual');
    }
  };

  return (
    <Dialog
      open={apiKey !== null}
      onClose={close}
      title={t('created.title')}
      closeLabel={t('created.close')}
    >
      <div className={styles.stack}>
        <p className={styles.warning}>{t('created.once')}</p>
        <Field label={t('created.key')}>
          {(control) => (
            <Input
              {...control}
              ref={inputRef}
              readOnly
              spellCheck={false}
              className={styles.secret}
              value={key}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </Field>
        <div className={styles.row}>
          <Button onClick={() => void copy()}>{t('created.copy')}</Button>
          <p aria-live="polite" className={styles.status}>
            {copyState === 'copied' && t('created.copied')}
            {copyState === 'manual' && t('created.copyManually')}
          </p>
        </div>
        <p className={styles.quiet}>{t('created.example')}</p>
        <pre className={styles.example}>
          <code>{`curl -H "X-API-Key: ${key}" ${window.location.origin}/v1/jobs`}</code>
        </pre>
        <Button variant="primary" className={styles.done} onClick={close}>
          {t('created.done')}
        </Button>
      </div>
    </Dialog>
  );
}
