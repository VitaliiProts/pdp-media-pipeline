import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type Location, useLocation } from 'react-router';
import { selectUploads } from '../../features/upload';
import { useAppSelector } from '../../shared/lib/redux';
import { useToast } from '../../shared/ui/toast/toast-context';

type Place = Pick<Location, 'pathname' | 'search'>;

/** The jobs sheet always shows failed uploads; the library only without filters. */
const showsUploads = ({ pathname, search }: Place): boolean =>
  pathname === '/jobs' || (pathname === '/library' && search === '');

/**
 * Failed uploads show on their own tiles on the jobs sheet and the unfiltered library;
 * elsewhere nobody would see them, so they come as alerts. Each failure is reported once.
 *
 * Call the returned function right before navigating: failures dispatched together with the
 * navigation render before it lands, so they are judged by the place it leads to.
 */
export function useUploadFailureToasts(): (place: Place) => void {
  const { t } = useTranslation('shell');
  const uploads = useAppSelector(selectUploads);
  const toast = useToast();
  const { pathname, search } = useLocation();
  const reported = useRef(new Set<string>());
  const destination = useRef<Place | null>(null);

  useEffect(() => {
    destination.current = null;
  }, [pathname, search]);

  useEffect(() => {
    const place = destination.current ?? { pathname, search };
    for (const upload of uploads) {
      if (upload.phase !== 'failed' || reported.current.has(upload.id)) continue;
      reported.current.add(upload.id);
      if (showsUploads(place)) continue;
      const key = upload.problem === 'quotaExceeded' ? 'upload.quotaExceeded' : 'upload.failed';
      toast({ tone: 'danger', message: t(key, { name: upload.fileName }) });
    }
  }, [uploads, pathname, search, toast, t]);

  return useCallback((place: Place) => {
    destination.current = place;
  }, []);
}
