import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STATUS_LABEL_KEY } from '../../../features/jobs';
import { VisuallyHidden } from '../../../shared/ui/visually-hidden/VisuallyHidden';
import {
  finishedSince,
  sameSnapshot,
  type StatusSnapshot,
  snapshotOf,
} from '../model/finished-jobs';
import { type SheetItem } from '../model/sheet-items';

type Announcement = { snapshot: StatusSnapshot | null; message: string };

/**
 * One polite live region for the whole sheet. It speaks only when a job reaches a
 * final state; the first load and every poll in between stay quiet.
 */
export function JobAnnouncer({ items }: { items: readonly SheetItem[] }) {
  const { t } = useTranslation(['workspace', 'jobs']);
  const [announcement, setAnnouncement] = useState<Announcement>({ snapshot: null, message: '' });
  const snapshot = snapshotOf(items);

  if (announcement.snapshot === null || !sameSnapshot(announcement.snapshot, snapshot)) {
    const finished = announcement.snapshot ? finishedSince(announcement.snapshot, items) : [];
    const message = finished
      .map((job) =>
        t('announce.finished', {
          title: job.title ?? t('untitled', { id: job.jobId.slice(0, 8) }),
          status: t(STATUS_LABEL_KEY[job.status], { ns: 'jobs' }),
        }),
      )
      .join(' ');
    setAnnouncement({ snapshot, message: message || announcement.message });
  }

  return (
    <VisuallyHidden>
      <span aria-live="polite">{announcement.message}</span>
    </VisuallyHidden>
  );
}
