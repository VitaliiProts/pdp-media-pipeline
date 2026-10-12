import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  type HttpStatus,
} from '@nestjs/common';
import { type Response } from 'express';

/** 429 or 503 that tells the client when to come back. */
export class RetryLaterException extends HttpException {
  constructor(
    status: HttpStatus.TOO_MANY_REQUESTS | HttpStatus.SERVICE_UNAVAILABLE,
    message: string,
    readonly retryAfterS: number,
  ) {
    super({ statusCode: status, message, retryAfterSeconds: retryAfterS }, status);
  }
}

/** HTTP allows only whole seconds; never 0, which would invite an immediate retry. */
export const toRetryAfterSeconds = (us: number): number => Math.max(1, Math.ceil(us / 1_000_000));

@Catch(RetryLaterException)
export class RetryLaterFilter implements ExceptionFilter<RetryLaterException> {
  catch(error: RetryLaterException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', String(error.retryAfterS));
    res.status(error.getStatus()).json(error.getResponse());
  }
}
