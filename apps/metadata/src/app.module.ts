import { Module } from '@nestjs/common';
import { createConfigModule } from '@pdp/config';
import { createLoggerModule, HealthModule } from '@pdp/observability';
import { envSchema } from './config';
import { DatabaseModule } from './database/database.module';
import { PostgresService } from './database/postgres.service';

@Module({
  imports: [
    createConfigModule(envSchema),
    createLoggerModule('metadata'),
    DatabaseModule,
    HealthModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [PostgresService],
      useFactory: (pg: PostgresService) => [{ name: 'postgres', check: () => pg.ping() }],
    }),
  ],
})
export class AppModule {}
