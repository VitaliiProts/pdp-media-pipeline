import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { createConfigModule } from '@pdp/config';
import { NatsModule } from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { HealthModule, ObservabilityModule } from '@pdp/observability';
import { AssetsController } from './assets/assets.controller';
import { ApiKeyGuard } from './auth/api-key.guard';
import { ApiKeysController } from './auth/api-keys.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { SessionCookie } from './auth/session-cookie';
import { SessionService } from './auth/session.service';
import { BackpressureService } from './backpressure/backpressure.service';
import { QueueDepthService } from './backpressure/queue-depth.service';
import { MetadataErrorFilter } from './common/metadata-error.filter';
import { egressClientProvider } from './common/public-url';
import { RetryLaterFilter } from './common/retry-later';
import { type Env, envSchema } from './config';
import { JobPresenter } from './jobs/job-presenter';
import { DubQuotaController } from './jobs/dub-quota.controller';
import { JobsController } from './jobs/jobs.controller';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { UploadsController } from './uploads/uploads.controller';
import { WebhooksController } from './webhooks/webhooks.controller';

@Module({
  imports: [
    createConfigModule(envSchema),
    ObservabilityModule.forRoot('api-gateway'),
    NatsModule.forRoot('api-gateway'),
    RedisModule,
    StorageModule,
    // No dependency is checked: each one degrades on its own, so an outage of one shared by
    // every replica must not take them all out of the load balancer. Rate limiting (ADR-005)
    // and the queue depth fail open; sessions (ADR-013), storage and Metadata answer 503.
    HealthModule.forRootAsync({ useFactory: () => [] }),
  ],
  controllers: [
    AuthController,
    ApiKeysController,
    UploadsController,
    JobsController,
    DubQuotaController,
    AssetsController,
    WebhooksController,
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
    egressClientProvider,
    JobPresenter,
    RateLimiterService,
    ApiKeyGuard,
    SessionService,
    SessionCookie,
    AuthGuard,
    RateLimitGuard,
    QueueDepthService,
    BackpressureService,
    { provide: APP_FILTER, useClass: MetadataErrorFilter },
    { provide: APP_FILTER, useClass: RetryLaterFilter },
  ],
})
export class AppModule {}
