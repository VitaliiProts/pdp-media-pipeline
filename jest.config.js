/** Unit tests across the workspace with one combined coverage report. */
module.exports = {
  projects: ['<rootDir>/apps/*/jest.config.js', '<rootDir>/libs/*/jest.config.js'],
  // Coverage options are global in multi-project mode; listing all sources reports untested files too.
  collectCoverageFrom: [
    '{apps,libs}/*/src/**/*.ts',
    '!**/*.spec.ts',
    '!**/main.ts',
    '!**/index.ts',
    '!apps/web/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'json', 'lcov'],
};
