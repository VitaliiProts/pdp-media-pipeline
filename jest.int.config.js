/** Integration tests: real Postgres, NATS and MinIO via Testcontainers. Needs Docker. */
process.env.PACT_DO_NOT_TRACK ??= 'true';

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
  // Applies only with --coverage, as in CI. Branches have their floor in the merged report
  // (scripts/coverage.mjs), with the unit tests.
  coverageThreshold: { global: { lines: 80, statements: 80, functions: 80 } },
  coverageDirectory: '<rootDir>/coverage-int',
  coverageReporters: ['text-summary', 'json-summary', 'json', 'lcov'],
};
