import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { type Env } from '../config';

@Injectable()
export class PostgresService implements OnApplicationShutdown {
  private readonly logger = new Logger(PostgresService.name);
  readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: 10,
      connectionTimeoutMillis: 2000,
    });
    this.pool.on('error', (err) => this.logger.error(err, 'idle client error'));
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
