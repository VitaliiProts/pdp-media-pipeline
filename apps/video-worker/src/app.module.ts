import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { HealthModule, ObservabilityModule } from '@pdp/observability';
import {
  egressClientProvider,
  ObjectStorage,
  ObjectStorageModule,
  sourceFetcherProvider,
} from '@pdp/worker-kit';
import { type Env, envSchema } from './config';
import { JobsService } from './jobs/jobs.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    ObservabilityModule.forRoot('video-worker'),
    NatsModule.forRoot('video-worker'),
    ObjectStorageModule,
    HealthModule.forRootAsync({
      imports: [ObjectStorageModule],
      inject: [NatsService, ObjectStorage],
      useFactory: (nats: NatsService, storage: ObjectStorage) => [
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
    egressClientProvider('pdp-video-worker'),
    sourceFetcherProvider,
    JobsService,
  ],
})
export class AppModule {}
