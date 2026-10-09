import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it.each([
    [512, '512 byte'],
    [1536, '1.5 kB'],
    [20 * 1024 * 1024, '20 MB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes, 'en')).toBe(expected);
  });
});
