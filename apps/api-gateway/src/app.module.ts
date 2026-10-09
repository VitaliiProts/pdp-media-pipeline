import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { createLoggerModule, HealthModule } from '@pdp/observability';
import { ApiKeyGuard } from './auth/api-key.guard';
import { MetadataErrorFilter } from './common/metadata-error.filter';
import { type Env, envSchema } from './config';
import { JobsController } from './jobs/jobs.controller';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { StorageModule } from './storage/storage.module';
import { StorageService } from './storage/storage.service';
import { UploadsController } from './uploads/uploads.controller';

@Module({
  imports: [
    createConfigModule(envSchema),
    createLoggerModule('api-gateway'),
    NatsModule.forRoot('api-gateway'),
    RedisModule,
    StorageModule,
    HealthModule.forRootAsync({
      imports: [RedisModule, StorageModule],
      inject: [RedisService, NatsService, StorageService],
      useFactory: (redis: RedisService, nats: NatsService, storage: StorageService) => [
        { name: 'redis', check: () => redis.ping() },
        { name: 'nats', check: () => nats.ping() },
        { name: 's3', check: () => storage.ping() },
      ],
    }),
  ],
  controllers: [UploadsController, JobsController],
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
    ApiKeyGuard,
    { provide: APP_FILTER, useClass: MetadataErrorFilter },
  ],
})
export class AppModule {}
