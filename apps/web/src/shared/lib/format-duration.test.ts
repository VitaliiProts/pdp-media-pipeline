import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('shows minutes and seconds, and hours only when there are some', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(12.4)).toBe('0:12');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
