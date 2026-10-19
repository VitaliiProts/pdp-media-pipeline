import { ConfigService } from '@nestjs/config';
import { type S3Env, s3Connection } from './s3';

const connect = (env: Partial<S3Env>) =>
  s3Connection(
    new ConfigService<S3Env, true>({
      S3_REGION: 'eu-central-1',
      S3_BUCKET: 'media',
      S3_FORCE_PATH_STYLE: false,
      ...env,
    }),
  );

describe('s3Connection', () => {
  it('passes MinIO keys and endpoint through', () => {
    expect(
      connect({
        S3_ENDPOINT: 'http://minio:9000',
        S3_FORCE_PATH_STYLE: true,
        S3_ACCESS_KEY: 'minioadmin',
        S3_SECRET_KEY: 'secret',
      }),
    ).toEqual({
      endpoint: 'http://minio:9000',
      region: 'eu-central-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'secret' },
    });
  });

  it('leaves credentials and endpoint to the SDK when neither is set', () => {
    expect(connect({})).toEqual({
      endpoint: undefined,
      region: 'eu-central-1',
      forcePathStyle: false,
      credentials: undefined,
    });
  });

  it('refuses one key without the other', () => {
    expect(() => connect({ S3_ACCESS_KEY: 'minioadmin' })).toThrow(/together/);
    expect(() => connect({ S3_SECRET_KEY: 'secret' })).toThrow(/together/);
  });
});
