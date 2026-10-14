import { ForbiddenException } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type Request } from 'express';
import { type Env } from '../config';
import { readCookie, SessionCookie } from './session-cookie';

const APP = 'http://app.pdp.localhost:19080';

function cookie(): SessionCookie {
  const values: Partial<Env> = {
    SESSION_COOKIE_SECURE: true,
    SESSION_MAX_AGE_S: 3600,
    APP_ORIGINS: [APP],
  };
  return new SessionCookie({
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>);
}

const request = (headers: Record<string, string>) =>
  ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('theme=dark; pdp_session=abc; lang=uk', 'pdp_session')).toBe('abc');
  });

  it('does not match a cookie whose name only ends the same', () => {
    expect(readCookie('xpdp_session=evil', 'pdp_session')).toBeUndefined();
  });

  it('treats a missing header and an empty value as no cookie', () => {
    expect(readCookie(undefined, 'pdp_session')).toBeUndefined();
    expect(readCookie('pdp_session=', 'pdp_session')).toBeUndefined();
  });
});

describe('SessionCookie.checkOrigin', () => {
  it('accepts the Web UI origin', () => {
    expect(() => cookie().checkOrigin(request({ origin: APP }), true)).not.toThrow();
  });

  it('refuses another origin even where Origin is optional', () => {
    expect(() => cookie().checkOrigin(request({ origin: 'https://evil.example' }), false)).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a missing Origin only when it is required', () => {
    expect(() => cookie().checkOrigin(request({}), true)).toThrow(ForbiddenException);
    expect(() => cookie().checkOrigin(request({}), false)).not.toThrow();
  });
});

describe('SessionCookie.set', () => {
  it('sets an HttpOnly, Secure, SameSite=Lax cookie with the max age', () => {
    const res = { cookie: jest.fn() };
    cookie().set(res as never, 'token');
    expect(res.cookie).toHaveBeenCalledWith('pdp_session', 'token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3_600_000,
    });
  });
});
