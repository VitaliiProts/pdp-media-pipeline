/**
 * Pact consumer tests: write the contracts to pacts/, which `test:pact` empties first, since
 * Pact adds to an existing file. No Docker; the providers verify them in test:int.
 */
process.env.PACT_DO_NOT_TRACK ??= 'true';

module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/pact/consumers/*.pact-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  testTimeout: 30_000,
};
