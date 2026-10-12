import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const TICK_MS = 250;

/** Seconds left until `until`, never below zero. */
export function Countdown({ until, className }: { until: number; className?: string }) {
  const { t } = useTranslation('workspace');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <span className={className} role="timer">
      {t('retryIn', { count: seconds })}
    </span>
  );
}
