/** Unit tests across the workspace with one combined coverage report. */
module.exports = {
  projects: ['<rootDir>/apps/*/jest.config.js', '<rootDir>/libs/*/jest.config.js'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],
};
