import { useEffect, useState } from 'react';

const SECOND_MS = 1000;

/** Seconds left of a wait the server asked for; `start` begins a new one. */
export function useCountdown(): [secondsLeft: number, start: (seconds: number) => void] {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), SECOND_MS);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  return [secondsLeft, setSecondsLeft];
}
