import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export const BUCKET = 'media';
const MINIO_CREDENTIALS = { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' };

export interface Infra {
  databaseUrl: string;
  natsUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3: S3Client;
  /** Runs `redis-cli` inside the Redis container, e.g. FLUSHALL or CLIENT PAUSE. */
  redisCli: (...args: string[]) => Promise<string>;
  stop: () => Promise<void>;
}

export async function startInfra(): Promise<Infra> {
  const [postgres, nats, redis, minio] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new GenericContainer('nats:2.10-alpine')
      .withCommand(['-js'])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('pgsty/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start(),
  ]);

  const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  const s3 = new S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: MINIO_CREDENTIALS,
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

  return {
    databaseUrl: postgres.getConnectionUri(),
    natsUrl: `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`,
    redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    s3Endpoint,
    s3,
    redisCli: async (...args) => {
      const { exitCode, output } = await redis.exec(['redis-cli', ...args]);
      if (exitCode !== 0)
        throw new Error(`redis-cli ${args.join(' ')} exited with ${exitCode}: ${output}`);
      return output.trim();
    },
    stop: async () => {
      s3.destroy();
      await Promise.all([postgres, nats, redis, minio].map((c: StartedTestContainer) => c.stop()));
    },
  };
}
