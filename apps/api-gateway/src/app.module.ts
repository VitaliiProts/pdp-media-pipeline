import { Module } from '@nestjs/common';
import { createConfigModule } from '@pdp/config';
import { NatsModule, NatsService } from '@pdp/messaging';
import { createLoggerModule, HealthModule } from '@pdp/observability';
import { envSchema } from './config';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    createLoggerModule('api-gateway'),
    NatsModule.forRoot('api-gateway'),
    RedisModule,
    HealthModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService, NatsService],
      useFactory: (redis: RedisService, nats: NatsService) => [
        { name: 'redis', check: () => redis.ping() },
        { name: 'nats', check: () => nats.ping() },
      ],
    }),
  ],
})
export class AppModule {}
