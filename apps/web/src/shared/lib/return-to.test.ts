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
    ['/\t/evil.example', DEFAULT_RETURN_TO],
    ['/\n/evil.example', DEFAULT_RETURN_TO],
    ['/\r/evil.example', DEFAULT_RETURN_TO],
    ['/LOGIN?next=/jobs', DEFAULT_RETURN_TO],
    ['/Login', DEFAULT_RETURN_TO],
    ['/login#x', DEFAULT_RETURN_TO],
    ['/.//evil.example', DEFAULT_RETURN_TO],
    ['/a/..//evil.example', DEFAULT_RETURN_TO],
    ['/%2e//evil.example', DEFAULT_RETURN_TO],
    ['/%6Cogin', DEFAULT_RETURN_TO],
    ['/%E0%A4%A', DEFAULT_RETURN_TO],
    ['/jobs/./x', '/jobs/x'],
  ])('%s → %s', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it('builds the sign-in address with the return path encoded', () => {
    expect(loginPath('/jobs?status=dead')).toBe('/login?next=%2Fjobs%3Fstatus%3Ddead');
  });
});
