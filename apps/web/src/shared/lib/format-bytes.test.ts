import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it.each([
    [0, 'en', '0 B'],
    [144, 'en', '144 B'],
    [999, 'en', '999 B'],
    [1_000, 'en', '1 kB'],
    [1_536, 'en', '1.5 kB'],
    [999_000, 'en', '999 kB'],
    [20_000_000, 'en', '20 MB'],
    [144, 'uk', '144 Б'],
    [1_536, 'uk', '1,5 кБ'],
  ])('formats %i in %s as %s', (bytes, locale, expected) => {
    expect(formatBytes(bytes, locale)).toBe(expected);
  });
});
