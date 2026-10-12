import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { MetadataClient } from '@pdp/metadata-client';
import { HealthModule, MetricsModule, ObservabilityModule } from '@pdp/observability';
import { type Env, envSchema } from './config';
import { DispatchService } from './dispatch/dispatch.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    ObservabilityModule.forRoot('scheduler'),
    MetricsModule,
    NatsModule.forRoot('scheduler'),
    HealthModule.forRootAsync({
      inject: [NatsService],
      useFactory: (nats: NatsService) => [{ name: 'nats', check: () => nats.ping() }],
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
    DispatchService,
  ],
})
export class AppModule {}
