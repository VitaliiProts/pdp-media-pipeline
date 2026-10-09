/** Integration tests: real Postgres, NATS and MinIO via Testcontainers. Needs Docker. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  testTimeout: 180_000,
  maxWorkers: 1,
};
