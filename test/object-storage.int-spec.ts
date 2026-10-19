import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { ObjectStorage } from '@pdp/worker-kit';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

describe('ObjectStorage (MinIO)', () => {
  let minio: StartedTestContainer;
  let storage: ObjectStorage;

  beforeAll(async () => {
    minio = await new GenericContainer('pgsty/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start();
    storage = new ObjectStorage({
      endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      bucket: 'media',
    });
    await storage.client.send(new CreateBucketCommand({ Bucket: 'media' }));
  }, 120_000);

  afterAll(async () => {
    storage.onApplicationShutdown();
    await minio.stop();
  });

  it('tells whether an object exists without treating a missing one as an error', async () => {
    await storage.putObject(
      'results/j1/dub/transcript.json',
      Buffer.from('{}'),
      'application/json',
    );
    await expect(storage.exists('results/j1/dub/transcript.json')).resolves.toBe(true);
    await expect(storage.exists('results/j1/dub/analysis.json')).resolves.toBe(false);
  });

  it('copies an object inside the bucket', async () => {
    await storage.putObject('results/a/dub/audio.flac', Buffer.from('fLaC'), 'audio/flac');
    await storage.copyObject('results/a/dub/audio.flac', 'results/b/dub/audio.flac');
    await expect(storage.getObject('results/b/dub/audio.flac', 100)).resolves.toEqual(
      Buffer.from('fLaC'),
    );
  });
});
