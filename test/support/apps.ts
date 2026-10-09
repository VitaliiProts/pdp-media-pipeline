import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type * as GatewayMain from '../../apps/api-gateway/src/main';
import { BUCKET, type Infra } from './infra';

const appModule = (mod: unknown): unknown => (mod as { AppModule: unknown }).AppModule;

/* eslint-disable @typescript-eslint/no-require-imports -- deferred until the env is set */
const loaders: Record<AppName, () => unknown> = {
  metadata: () => appModule(require('../../apps/metadata/src/app.module')),
  scheduler: () => appModule(require('../../apps/scheduler/src/app.module')),
  'api-gateway': () => appModule(require('../../apps/api-gateway/src/app.module')),
  worker: () => appModule(require('../../apps/worker/src/app.module')),
};
const loadConfigureGateway = () =>
  (require('../../apps/api-gateway/src/main') as typeof GatewayMain).configureApp;
/* eslint-enable @typescript-eslint/no-require-imports */

export type AppName = 'metadata' | 'scheduler' | 'api-gateway' | 'worker';

export interface RunningApps {
  urls: Partial<Record<AppName, string>>;
  start: (name: AppName, env?: Record<string, string>) => Promise<string>;
  stop: (name: AppName) => Promise<void>;
  stopAll: () => Promise<void>;
}

/**
 * Runs the real Nest apps in the test process on random ports. Each app module is
 * imported only after its env is set, because `ConfigModule.forRoot` validates the
 * environment at import time.
 */
export function createApps(infra: Infra): RunningApps {
  const running = new Map<AppName, INestApplication>();
  const urls: RunningApps['urls'] = {};

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'warn',
    DATABASE_URL: infra.databaseUrl,
    NATS_URL: infra.natsUrl,
    REDIS_URL: infra.redisUrl,
    S3_ENDPOINT: infra.s3Endpoint,
    S3_PUBLIC_ENDPOINT: infra.s3Endpoint,
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: BUCKET,
    OUTBOX_POLL_MS: '50',
    WORKER_CONCURRENCY: '2',
  });

  const start: RunningApps['start'] = async (name, env = {}) => {
    if (name !== 'metadata') {
      if (!urls.metadata) throw new Error('start metadata first');
      process.env.METADATA_URL = urls.metadata;
    }
    Object.assign(process.env, env);
    const app = await NestFactory.create(loaders[name]() as never, { logger: ['error'] });
    if (name === 'api-gateway') {
      loadConfigureGateway()(app);
    }
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    running.set(name, app);
    urls[name] = url;
    return url;
  };

  const stop: RunningApps['stop'] = async (name) => {
    await running.get(name)?.close();
    running.delete(name);
    delete urls[name];
  };

  const stopAll = async () => {
    for (const name of ['worker', 'scheduler', 'api-gateway', 'metadata'] as const) {
      await stop(name);
    }
  };

  return { urls, start, stop, stopAll };
}
