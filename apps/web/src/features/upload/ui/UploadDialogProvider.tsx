import { type ReactNode, useCallback, useState } from 'react';
import { OpenUploadContext } from '../model/open-upload-context';
import { UploadDialog } from './UploadDialog';

type UploadDialogProviderProps = {
  /** Called once files are handed to the upload queue, with how many. */
  onStarted: (count: number) => void;
  children: ReactNode;
};

export function UploadDialogProvider({ onStarted, children }: UploadDialogProviderProps) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  return (
    <OpenUploadContext value={open}>
      {children}
      <UploadDialog open={isOpen} onClose={() => setOpen(false)} onStarted={onStarted} />
    </OpenUploadContext>
  );
}
