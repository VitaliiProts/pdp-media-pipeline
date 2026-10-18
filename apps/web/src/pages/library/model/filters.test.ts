import { hasFilters } from './filters';

describe('hasFilters', () => {
  const none = { kind: null, status: null, q: '', dubbed: false } as const;

  it.each([
    [none, false],
    [{ ...none, q: '  ' }, false],
    [{ ...none, q: ' sea ' }, true],
    [{ ...none, kind: 'video' }, true],
    [{ ...none, status: 'failed' }, true],
    [{ ...none, dubbed: true }, true],
  ] as const)('%o → %s', (filters, expected) => {
    expect(hasFilters(filters)).toBe(expected);
  });
});
