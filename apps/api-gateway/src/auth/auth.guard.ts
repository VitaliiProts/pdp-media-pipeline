import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { API_KEY_HEADER } from '@pdp/contracts';
import { type Response } from 'express';
import { ApiKeyGuard } from './api-key.guard';
import { isUnsafeMethod, SessionCookie } from './session-cookie';
import { SessionService } from './session.service';
import { type AuthenticatedRequest } from './user';

/**
 * Either an API key (scripts, k6, integrations) or a session cookie (the Web UI). A request
 * with `X-API-Key` is judged by the key alone, so a stale cookie cannot get in its way.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyGuard,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    if (req.header(API_KEY_HEADER)) {
      await this.apiKeys.canActivate(context);
      req.authMethod = 'api-key';
      return true;
    }

    const token = this.cookie.read(req);
    if (!token) throw new UnauthorizedException('missing api key or session');
    if (isUnsafeMethod(req.method)) this.cookie.checkOrigin(req, true);

    const session = await this.sessions.resolve(token);
    if (!session) {
      this.cookie.clear(http.getResponse<Response>());
      throw new UnauthorizedException('session expired');
    }
    req.userId = session.userId;
    req.authMethod = 'session';
    return true;
  }
}
