import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

/** Run through scripts/e2e.sh, which starts the stack and sets the base URL from e2e/.env. */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  outputDir: './test-results',
  // A translation with fake providers takes well under a minute; the rest a few seconds.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: CI,
  workers: 2,
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:28090',
    locale: 'en-US',
    // The app drops its animations then, so axe measures contrast at the final colours.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
