import { Module } from '@nestjs/common';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { createLoggerModule, HealthModule } from '@pdp/observability';
import { envSchema } from './config';
import { StorageModule } from './storage/storage.module';
import { StorageService } from './storage/storage.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    createLoggerModule('worker'),
    NatsModule.forRoot('worker'),
    StorageModule,
    HealthModule.forRootAsync({
      imports: [StorageModule],
      inject: [NatsService, StorageService],
      useFactory: (nats: NatsService, storage: StorageService) => [
        { name: 'nats', check: () => nats.ping() },
        { name: 's3', check: () => storage.ping() },
      ],
    }),
  ],
})
export class AppModule {}
