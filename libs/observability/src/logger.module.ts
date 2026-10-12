import { type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

export function createLoggerModule(serviceName: string): DynamicModule {
  return LoggerModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const pretty = config.get<string>('NODE_ENV') === 'development';
      return {
        pinoHttp: {
          name: serviceName,
          level: config.get<string>('LOG_LEVEL') ?? 'info',
          base: { service: serviceName },
          redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
          autoLogging: { ignore: (req) => /^\/(health|metrics)\b/.test(req.url ?? '') },
          transport: pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        },
      };
    },
  });
}
