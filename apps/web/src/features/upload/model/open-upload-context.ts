import { createContext, useContext } from 'react';

export const OpenUploadContext = createContext<(() => void) | null>(null);

/** Opens the upload dialog that the app shell renders. */
export function useOpenUpload(): () => void {
  const open = useContext(OpenUploadContext);
  if (!open) throw new Error('useOpenUpload needs an UploadDialogProvider above it');
  return open;
}
