import { formatTimecode } from './timecode';

describe('formatTimecode', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(7)).toBe('0:07');
    expect(formatTimecode(65)).toBe('1:05');
  });

  it('keeps tenths for frames between seconds', () => {
    expect(formatTimecode(2.5)).toBe('0:02.5');
  });
});
