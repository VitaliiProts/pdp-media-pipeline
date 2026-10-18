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
  // Libs are loaded from their dist, so only app sources are attributed here.
  // The web app is covered by Vitest, not by these tests.
  collectCoverageFrom: ['apps/*/src/**/*.ts', '!**/*.spec.ts', '!**/main.ts', '!apps/web/**'],
  coverageDirectory: '<rootDir>/coverage-int',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
};
