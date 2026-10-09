import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { type Env } from '../config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class PostgresService implements OnApplicationShutdown {
  private readonly logger = new Logger(PostgresService.name);
  readonly pool: Pool;
  readonly db: Db;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: config.get('DATABASE_POOL_SIZE', { infer: true }),
      connectionTimeoutMillis: 2000,
    });
    this.pool.on('error', (err) => this.logger.error(err, 'idle client error'));
    this.db = drizzle(this.pool, { schema });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
