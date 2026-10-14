import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { type ApiKeyGuard } from './api-key.guard';
import { AuthGuard } from './auth.guard';
import { type SessionCookie } from './session-cookie';
import { type SessionService } from './session.service';
import { type AuthenticatedRequest } from './user';

const USER_ID = '5b0c5a8e-0000-4000-8000-000000000001';

function setup() {
  const apiKeys = { canActivate: jest.fn().mockResolvedValue(true) };
  const sessions = { resolve: jest.fn() };
  const cookie = {
    read: jest.fn(),
    clear: jest.fn(),
    checkOrigin: jest.fn(),
  };
  const guard = new AuthGuard(
    apiKeys as unknown as ApiKeyGuard,
    sessions as unknown as SessionService,
    cookie as unknown as SessionCookie,
  );
  return { apiKeys, sessions, cookie, guard };
}

function context(method: string, headers: Record<string, string> = {}) {
  const req = {
    method,
    header: (name: string) => headers[name.toLowerCase()],
  } as AuthenticatedRequest;
  const res = {};
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { req, res, ctx };
}

describe('AuthGuard', () => {
  it('judges a request with X-API-Key by the key alone', async () => {
    const { guard, apiKeys, cookie, sessions } = setup();
    const { req, ctx } = context('POST', { 'x-api-key': 'pdp_k' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(apiKeys.canActivate).toHaveBeenCalledWith(ctx);
    expect(req.authMethod).toBe('api-key');
    expect(cookie.read).not.toHaveBeenCalled();
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it('refuses a request with neither a key nor a session', async () => {
    const { guard, cookie } = setup();
    cookie.read.mockReturnValue(undefined);
    await expect(guard.canActivate(context('GET').ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a live session and records how the user got in', async () => {
    const { guard, cookie, sessions } = setup();
    cookie.read.mockReturnValue('token');
    sessions.resolve.mockResolvedValue({ userId: USER_ID, createdAt: Date.now() });
    const { req, ctx } = context('GET');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.userId).toBe(USER_ID);
    expect(req.authMethod).toBe('session');
    expect(cookie.checkOrigin).not.toHaveBeenCalled();
  });

  it('requires the Origin on requests that change data, before touching Redis', async () => {
    const { guard, cookie, sessions } = setup();
    cookie.read.mockReturnValue('token');
    cookie.checkOrigin.mockImplementation(() => {
      throw new ForbiddenException();
    });

    await expect(guard.canActivate(context('DELETE').ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cookie.checkOrigin).toHaveBeenCalledWith(expect.anything(), true);
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it('clears the cookie of an expired session', async () => {
    const { guard, cookie, sessions } = setup();
    cookie.read.mockReturnValue('token');
    sessions.resolve.mockResolvedValue(null);
    const { res, ctx } = context('GET');

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(cookie.clear).toHaveBeenCalledWith(res);
  });
});
