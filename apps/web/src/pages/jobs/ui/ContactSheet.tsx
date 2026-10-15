import { useTranslation } from 'react-i18next';
import { RedriveButton, TraceLink } from '../../../features/jobs';
import { describeItem } from '../model/describe-item';
import { type SheetItem } from '../model/sheet-items';
import styles from './ContactSheet.module.css';
import { SlideMount } from './SlideMount';

type ContactSheetProps = {
  items: readonly SheetItem[];
  onDismiss: (uploadId: string) => void;
};

export function ContactSheet({ items, onDismiss }: ContactSheetProps) {
  const { t } = useTranslation('workspace');

  return (
    <ol className={styles.sheet}>
      {items.map((item) => (
        <li key={item.key}>
          {item.kind === 'job' ? (
            <SlideMount
              title={item.title ?? t('untitled', { id: item.jobId.slice(0, 8) })}
              previewUrl={item.previewUrl}
              description={describeItem(item)}
              attempts={item.attempts}
              results={item.results}
              frames={item.frames}
              action={
                <>
                  {item.status === 'dead' && <RedriveButton jobId={item.jobId} />}
                  <TraceLink jobId={item.jobId} traceId={item.traceId} createdAt={item.createdAt} />
                </>
              }
            />
          ) : (
            <SlideMount
              title={item.title}
              previewUrl={item.previewUrl}
              description={describeItem(item)}
              attempts={0}
              results={[]}
              frames={[]}
              onDismiss={item.stage.phase === 'failed' ? () => onDismiss(item.uploadId) : undefined}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
