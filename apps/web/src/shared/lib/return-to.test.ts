import { DEFAULT_RETURN_TO, loginPath, safeReturnTo } from './return-to';

describe('return address after sign-in', () => {
  it.each([
    ['/webhooks', '/webhooks'],
    ['/jobs?status=dead', '/jobs?status=dead'],
    [null, DEFAULT_RETURN_TO],
    ['', DEFAULT_RETURN_TO],
    ['https://evil.example', DEFAULT_RETURN_TO],
    ['//evil.example', DEFAULT_RETURN_TO],
    ['/\\evil.example', DEFAULT_RETURN_TO],
    ['/login?next=/jobs', DEFAULT_RETURN_TO],
  ])('%s → %s', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it('builds the sign-in address with the return path encoded', () => {
    expect(loginPath('/jobs?status=dead')).toBe('/login?next=%2Fjobs%3Fstatus%3Ddead');
  });
});
