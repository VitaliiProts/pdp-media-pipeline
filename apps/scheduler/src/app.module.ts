import { Module } from '@nestjs/common';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { createLoggerModule, HealthModule } from '@pdp/observability';
import { envSchema } from './config';

@Module({
  imports: [
    createConfigModule(envSchema),
    createLoggerModule('scheduler'),
    NatsModule.forRoot('scheduler'),
    HealthModule.forRootAsync({
      inject: [NatsService],
      useFactory: (nats: NatsService) => [{ name: 'nats', check: () => nats.ping() }],
    }),
  ],
})
export class AppModule {}
