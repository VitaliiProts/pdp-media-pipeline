import { hasFilters } from './filters';

describe('hasFilters', () => {
  it.each([
    [{ kind: null, status: null, q: '' }, false],
    [{ kind: null, status: null, q: '  ' }, false],
    [{ kind: null, status: null, q: ' sea ' }, true],
    [{ kind: 'video', status: null, q: '' }, true],
    [{ kind: null, status: 'failed', q: '' }, true],
  ] as const)('%o → %s', (filters, expected) => {
    expect(hasFilters(filters)).toBe(expected);
  });
});
