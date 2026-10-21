import { type DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { HttpRouteInterceptor } from './http-route.interceptor';
import { shutdownTelemetry } from './telemetry';
import { jobLogFields } from './tracing';

/** A failed response is an error in the logs too, not only in the metrics. */
export function httpLogLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): 'error' | 'info' {
  return err || res.statusCode >= 500 ? 'error' : 'info';
}

class TelemetryShutdown implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTelemetry();
  }
}

/**
 * Pino logging plus telemetry lifecycle. `trace_id` and `span_id` are added by the pino
 * instrumentation, `job_id` and `job_type` come from baggage while a job is in context.
 */
@Module({})
export class ObservabilityModule {
  static forRoot(serviceName: string): DynamicModule {
    return {
      module: ObservabilityModule,
      imports: [
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const pretty = config.get<string>('NODE_ENV') === 'development';
            return {
              pinoHttp: {
                name: serviceName,
                level: config.get<string>('LOG_LEVEL') ?? 'info',
                base: { service: serviceName },
                mixin: jobLogFields,
                redact: [
                  'req.headers.authorization',
                  'req.headers["x-api-key"]',
                  'req.headers.cookie',
                  'res.headers["set-cookie"]',
                ],
                autoLogging: { ignore: (req) => /^\/health\b/.test(req.url ?? '') },
                customLogLevel: httpLogLevel,
                transport: pretty
                  ? { target: 'pino-pretty', options: { singleLine: true } }
                  : undefined,
              },
            };
          },
        }),
      ],
      providers: [TelemetryShutdown, { provide: APP_INTERCEPTOR, useClass: HttpRouteInterceptor }],
      exports: [LoggerModule],
    };
  }
}
