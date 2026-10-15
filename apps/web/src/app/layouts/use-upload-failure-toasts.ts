import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { selectUploads } from '../../features/upload';
import { useAppSelector } from '../../shared/lib/redux';
import { useToast } from '../../shared/ui/toast/toast-context';

/**
 * Failed uploads show on the jobs sheet; elsewhere nobody would see them, so they
 * come as alerts. Each failure is reported once.
 */
export function useUploadFailureToasts(): void {
  const { t } = useTranslation('shell');
  const uploads = useAppSelector(selectUploads);
  const toast = useToast();
  const { pathname } = useLocation();
  const reported = useRef(new Set<string>());

  useEffect(() => {
    for (const upload of uploads) {
      if (upload.phase !== 'failed' || reported.current.has(upload.id)) continue;
      reported.current.add(upload.id);
      if (pathname !== '/jobs') {
        toast({ tone: 'danger', message: t('upload.failed', { name: upload.fileName }) });
      }
    }
  }, [uploads, pathname, toast, t]);
}
