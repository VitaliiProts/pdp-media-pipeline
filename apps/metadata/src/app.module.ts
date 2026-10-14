import { Module } from '@nestjs/common';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { HealthModule, ObservabilityModule } from '@pdp/observability';
import { AccountsService } from './auth/accounts.service';
import { AuthController } from './auth/auth.controller';
import { envSchema } from './config';
import { DatabaseModule } from './database/database.module';
import { PostgresService } from './database/postgres.service';
import { IdempotencyJanitor } from './jobs/idempotency-janitor';
import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { OutboxRelay } from './outbox/outbox.relay';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WebhooksService } from './webhooks/webhooks.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    ObservabilityModule.forRoot('metadata'),
    DatabaseModule,
    NatsModule.forRoot('metadata'),
    HealthModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [PostgresService, NatsService],
      useFactory: (pg: PostgresService, nats: NatsService) => [
        { name: 'postgres', check: () => pg.ping() },
        { name: 'nats', check: () => nats.ping() },
      ],
    }),
  ],
  controllers: [JobsController, WebhooksController, AuthController],
  providers: [AccountsService, JobsService, WebhooksService, OutboxRelay, IdempotencyJanitor],
})
export class AppModule {}
