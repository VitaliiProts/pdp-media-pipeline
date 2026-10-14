import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESSION_COOKIE } from '@pdp/contracts';
import { type CookieOptions, type Request, type Response } from 'express';
import { type Env } from '../config';

/** Methods a cross-site page could trigger with the user's cookie to change something. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isUnsafeMethod = (method: string): boolean => UNSAFE_METHODS.has(method);

/** The value of one cookie from the `Cookie` header; express has no parser by default. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value || undefined;
  }
  return undefined;
}

/**
 * The session cookie and the checks a cookie needs that an API key does not (ADR-013):
 * `HttpOnly` keeps it from scripts, `SameSite=Lax` from most cross-site requests, and the
 * Origin check covers what `Lax` lets through.
 */
@Injectable()
export class SessionCookie {
  private readonly options: CookieOptions;
  private readonly maxAgeMs: number;
  private readonly origins: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.options = {
      httpOnly: true,
      secure: config.get('SESSION_COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      path: '/',
    };
    this.maxAgeMs = config.get('SESSION_MAX_AGE_S', { infer: true }) * 1000;
    this.origins = new Set(config.get('APP_ORIGINS', { infer: true }));
  }

  read(req: Request): string | undefined {
    return readCookie(req.header('cookie'), SESSION_COOKIE);
  }

  set(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, { ...this.options, maxAge: this.maxAgeMs });
  }

  clear(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.options);
  }

  /**
   * A foreign Origin is always refused. A missing one is refused only when `required`:
   * browsers send Origin with every POST and DELETE, so its absence on a request carrying a
   * session cookie means an old browser or a forged request; login and register also take
   * scripts and k6, which send none.
   */
  checkOrigin(req: Request, required: boolean): void {
    const origin = req.header('origin');
    if (origin === undefined && !required) return;
    if (origin === undefined || !this.origins.has(origin)) {
      throw new ForbiddenException('origin not allowed');
    }
  }
}
