import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { HealthModule, ObservabilityModule } from '@pdp/observability';
import { ApiKeyGuard } from './auth/api-key.guard';
import { BackpressureService } from './backpressure/backpressure.service';
import { QueueDepthService } from './backpressure/queue-depth.service';
import { MetadataErrorFilter } from './common/metadata-error.filter';
import { egressClientProvider } from './common/public-url';
import { RetryLaterFilter } from './common/retry-later';
import { type Env, envSchema } from './config';
import { JobsController } from './jobs/jobs.controller';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { StorageService } from './storage/storage.service';
import { UploadsController } from './uploads/uploads.controller';
import { WebhooksController } from './webhooks/webhooks.controller';

@Module({
  imports: [
    createConfigModule(envSchema),
    ObservabilityModule.forRoot('api-gateway'),
    NatsModule.forRoot('api-gateway'),
    RedisModule,
    StorageModule,
    // Redis is left out on purpose: rate limiting fails open (ADR-005), so a Redis
    // outage must not take every gateway replica out of the load balancer.
    HealthModule.forRootAsync({
      imports: [StorageModule],
      inject: [NatsService, StorageService],
      useFactory: (nats: NatsService, storage: StorageService) => [
        { name: 'nats', check: () => nats.ping() },
        { name: 's3', check: () => storage.ping() },
      ],
    }),
  ],
  controllers: [UploadsController, JobsController, WebhooksController],
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
    egressClientProvider,
    RateLimiterService,
    ApiKeyGuard,
    RateLimitGuard,
    QueueDepthService,
    BackpressureService,
    { provide: APP_FILTER, useClass: MetadataErrorFilter },
    { provide: APP_FILTER, useClass: RetryLaterFilter },
  ],
})
export class AppModule {}
