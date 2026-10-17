import { http as mock, HttpResponse } from 'msw';
import { server } from '../../test/server';
import {
  appErrorOf,
  errorCodeOf,
  http,
  httpStatusOf,
  isUnauthorized,
  retryAfterOf,
  toAppError,
} from './http';

describe('AppError helpers', () => {
  it('reads Retry-After only from refusals about timing', () => {
    expect(retryAfterOf({ kind: 'retryLater', status: 429, retryAfterS: 3 })).toBe(3);
    expect(retryAfterOf({ kind: 'network' })).toBeNull();
    expect(retryAfterOf({ message: 'serialized' })).toBeNull();
    expect(retryAfterOf(undefined)).toBeNull();
  });

  it('recognises a rejected sign-in', () => {
    expect(isUnauthorized({ kind: 'unauthorized' })).toBe(true);
    expect(isUnauthorized({ kind: 'http', status: 403, message: 'no', code: null })).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });

  it('narrows unknown values to app errors and nothing else', () => {
    expect(appErrorOf({ kind: 'network' })).toEqual({ kind: 'network' });
    expect(appErrorOf({ kind: 'other' })).toBeNull();
    expect(appErrorOf({ name: 'Error', message: 'boom' })).toBeNull();
    expect(appErrorOf('network')).toBeNull();
    expect(appErrorOf(null)).toBeNull();
  });

  it('reads the status of an HTTP refusal only', () => {
    expect(httpStatusOf({ kind: 'http', status: 404, message: 'gone', code: null })).toBe(404);
    expect(httpStatusOf({ kind: 'unauthorized' })).toBeNull();
    expect(httpStatusOf(undefined)).toBeNull();
  });
});

describe('toAppError', () => {
  it('keeps the code the gateway gave for a refusal', async () => {
    server.use(
      mock.post('/v1/auth/register', () =>
        HttpResponse.json(
          { statusCode: 409, code: 'EMAIL_TAKEN', message: 'email is already registered' },
          { status: 409 },
        ),
      ),
    );
    const error = await http.post('/v1/auth/register', {}).then(() => null, toAppError);

    expect(error).toEqual({
      kind: 'http',
      status: 409,
      message: 'email is already registered',
      code: 'EMAIL_TAKEN',
    });
    expect(errorCodeOf(error)).toBe('EMAIL_TAKEN');
  });

  it('has no code when the body has none', async () => {
    server.use(mock.get('/v1/jobs', () => HttpResponse.json({ message: 'bad' }, { status: 400 })));
    const error = await http.get('/v1/jobs').then(() => null, toAppError);

    expect(error).toEqual({ kind: 'http', status: 400, message: 'bad', code: null });
    expect(errorCodeOf(error)).toBeNull();
    expect(errorCodeOf({ kind: 'network' })).toBeNull();
  });
});
