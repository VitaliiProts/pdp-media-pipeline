import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Request } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  authMethod?: 'api-key' | 'session';
}

export const UserId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const userId = context.switchToHttp().getRequest<AuthenticatedRequest>().userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
});
