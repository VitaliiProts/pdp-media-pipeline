import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appErrorOf, errorCodeOf, httpStatusOf } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useDeleteAssetMutation } from '../api/assets-api';
import styles from './DeleteAssetButton.module.css';

type DeleteAssetButtonProps = { assetId: string; name: string; onDeleted: () => void };

/** Asks before deleting; `onDeleted` also runs when the file was already gone (404). */
export function DeleteAssetButton({ assetId, name, onDeleted }: DeleteAssetButtonProps) {
  const { t } = useTranslation('assets');
  const [deleteAsset, { isLoading }] = useDeleteAssetMutation();
  const [isOpen, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = () => {
    setProblem(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setProblem(null);
  };

  const confirm = async () => {
    setProblem(null);
    try {
      await deleteAsset(assetId).unwrap();
    } catch (error) {
      // Someone else deleted it first: the outcome the user wanted.
      if (httpStatusOf(error) !== 404) {
        const appError = appErrorOf(error);
        setProblem(
          errorCodeOf(error) === 'ASSET_BUSY'
            ? t('delete.busy')
            : [t('delete.failed'), appError?.kind === 'http' ? appError.message : '']
                .filter(Boolean)
                .join(' '),
        );
        return;
      }
    }
    setOpen(false);
    onDeleted();
  };

  return (
    <>
      <Button variant="danger" aria-label={t('delete.openLabel', { name })} onClick={open}>
        {t('delete.open')}
      </Button>
      <Dialog
        open={isOpen}
        // The answer is applied whatever the user does meanwhile, so the dialog waits for it.
        dismissible={!isLoading}
        onClose={close}
        title={t('delete.title', { name })}
        closeLabel={t('delete.close')}
      >
        <p className={styles.body}>{t('delete.body')}</p>
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="danger" isBusy={isLoading} onClick={() => void confirm()}>
            {t('delete.confirm')}
          </Button>
          <Button isBusy={isLoading} onClick={close}>
            {t('delete.cancel')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
