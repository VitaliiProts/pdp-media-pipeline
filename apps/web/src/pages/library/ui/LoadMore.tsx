import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui/button/Button';
import styles from './LoadMore.module.css';

/** Starts loading this far before the end of the grid scrolls into view. */
const PRELOAD_MARGIN = '600px';

/** What asked for the next page: a press moves focus on to it, scrolling does not. */
export type LoadTrigger = 'button' | 'scroll';

type LoadMoreProps = {
  isLoading: boolean;
  failed: boolean;
  onLoad: (trigger: LoadTrigger) => void;
};

/**
 * The button is always there for keyboards, screen readers and browsers without
 * IntersectionObserver; scrolling near it loads the next page on its own.
 */
export function LoadMore({ isLoading, failed, onLoad }: LoadMoreProps) {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || isLoading || failed || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoad('scroll');
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, failed, onLoad]);

  return (
    <div className={styles.more}>
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      {failed && (
        <p role="alert" className={styles.failed}>
          {t('library.more.failed')}
        </p>
      )}
      <Button isBusy={isLoading} onClick={() => onLoad('button')}>
        {failed ? tShell('retry') : t('library.more.label')}
      </Button>
    </div>
  );
}
