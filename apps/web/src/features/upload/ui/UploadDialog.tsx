import { useTranslation } from 'react-i18next';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { UploadPanel } from './UploadPanel';

type UploadDialogProps = {
  open: boolean;
  onClose: () => void;
  onStarted: (count: number) => void;
};

export function UploadDialog({ open, onClose, onStarted }: UploadDialogProps) {
  const { t } = useTranslation('upload');
  return (
    <Dialog open={open} onClose={onClose} title={t('dialog.title')} closeLabel={t('dialog.close')}>
      <UploadPanel
        onSubmitted={(count) => {
          onClose();
          onStarted(count);
        }}
      />
    </Dialog>
  );
}
