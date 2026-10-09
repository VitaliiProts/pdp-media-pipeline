import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { MetadataError } from '@pdp/metadata-client';
import { type Response } from 'express';

/**
 * Metadata is an internal dependency: its outages become 503 for the client,
 * its 4xx keep their status and code.
 */
@Catch(MetadataError)
export class MetadataErrorFilter implements ExceptionFilter<MetadataError> {
  private readonly logger = new Logger(MetadataErrorFilter.name);

  catch(error: MetadataError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (error.retryable) {
      this.logger.warn(`metadata unavailable: ${error.status} ${error.message}`);
      res.status(503).json({ statusCode: 503, message: 'service temporarily unavailable' });
      return;
    }
    res.status(error.status).json({
      statusCode: error.status,
      code: error.code,
      message: error.message,
    });
  }
}
