import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { createLoggerModule, HealthModule, MetricsModule } from '@pdp/observability';
import { type Env, envSchema } from './config';
import { JobsService } from './jobs/jobs.service';
import { StorageModule } from './storage/storage.module';
import { StorageService } from './storage/storage.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    createLoggerModule('worker'),
    MetricsModule,
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
  providers: [
    {
      provide: MetadataClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new MetadataClient({
          baseUrl: config.get('METADATA_URL', { infer: true }),
          timeoutMs: config.get('METADATA_TIMEOUT_MS', { infer: true }),
        }),
    },
    JobsService,
  ],
})
export class AppModule {}
