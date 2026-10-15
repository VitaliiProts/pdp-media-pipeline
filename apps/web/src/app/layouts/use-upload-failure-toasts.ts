import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { selectUploads } from '../../features/upload';
import { useAppSelector } from '../../shared/lib/redux';
import { useToast } from '../../shared/ui/toast/toast-context';

/** Pages that show failed uploads on their own tiles. */
const PAGES_WITH_UPLOADS = ['/library', '/jobs'];

/**
 * Failed uploads show on the library and the jobs sheet; elsewhere nobody would see them,
 * so they come as alerts. Each failure is reported once.
 *
 * Call the returned function right before navigating: failures dispatched together with the
 * navigation render before it lands, so they are judged by the page it leads to.
 */
export function useUploadFailureToasts(): (pathname: string) => void {
  const { t } = useTranslation('shell');
  const uploads = useAppSelector(selectUploads);
  const toast = useToast();
  const { pathname } = useLocation();
  const reported = useRef(new Set<string>());
  const destination = useRef<string | null>(null);

  useEffect(() => {
    destination.current = null;
  }, [pathname]);

  useEffect(() => {
    const page = destination.current ?? pathname;
    for (const upload of uploads) {
      if (upload.phase !== 'failed' || reported.current.has(upload.id)) continue;
      reported.current.add(upload.id);
      if (PAGES_WITH_UPLOADS.includes(page)) continue;
      const key = upload.problem === 'quotaExceeded' ? 'upload.quotaExceeded' : 'upload.failed';
      toast({ tone: 'danger', message: t(key, { name: upload.fileName }) });
    }
  }, [uploads, pathname, toast, t]);

  return useCallback((next: string) => {
    destination.current = next;
  }, []);
}
