const pad = (value: number) => String(value).padStart(2, '0');

/** `m:ss`, or `h:mm:ss` from an hour up, like video players show it. */
export function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
