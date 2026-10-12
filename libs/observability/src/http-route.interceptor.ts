import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { type Observable } from 'rxjs';

/**
 * Hands the matched route ("/internal/jobs/:id/transitions") to the HTTP instrumentation,
 * which names the server span and sets `http.route` from it when the response ends.
 * Requests rejected before routing (e.g. by the auth guard) keep the bare method.
 */
@Injectable()
export class HttpRouteInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http') {
      const route = ctx.switchToHttp().getRequest<{ route?: { path?: unknown } }>().route?.path;
      const rpc = getRPCMetadata(context.active());
      if (rpc?.type === RPCType.HTTP && typeof route === 'string') rpc.route = route;
    }
    return next.handle();
  }
}
