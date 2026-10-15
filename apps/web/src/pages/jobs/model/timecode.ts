/** `m:ss`, with tenths only when the frame is not on a whole second. */
export function formatTimecode(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  const tenths = Math.round((seconds - whole) * 10);
  return tenths > 0 && tenths < 10 ? `${minutes}:${rest}.${tenths}` : `${minutes}:${rest}`;
}
