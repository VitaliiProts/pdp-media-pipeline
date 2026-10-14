import { isUnauthorized, retryAfterOf } from './http';

describe('AppError helpers', () => {
  it('reads Retry-After only from refusals about timing', () => {
    expect(retryAfterOf({ kind: 'retryLater', status: 429, retryAfterS: 3 })).toBe(3);
    expect(retryAfterOf({ kind: 'network' })).toBeNull();
    expect(retryAfterOf({ message: 'serialized' })).toBeNull();
    expect(retryAfterOf(undefined)).toBeNull();
  });

  it('recognises a rejected sign-in', () => {
    expect(isUnauthorized({ kind: 'unauthorized' })).toBe(true);
    expect(isUnauthorized({ kind: 'http', status: 403, message: 'no' })).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});
