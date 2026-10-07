import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NATS_OPTIONS, type NatsModuleOptions, NatsService } from './nats.service';

@Global()
@Module({})
export class NatsModule {
  /** Reads `NATS_URL` from the global ConfigService. */
  static forRoot(connectionName: string): DynamicModule {
    return {
      module: NatsModule,
      providers: [
        {
          provide: NATS_OPTIONS,
          inject: [ConfigService],
          useFactory: (config: ConfigService): NatsModuleOptions => ({
            servers: config.getOrThrow<string>('NATS_URL'),
            name: connectionName,
          }),
        },
        NatsService,
      ],
      exports: [NatsService],
    };
  }
}
