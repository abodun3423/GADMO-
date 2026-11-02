import { defineConfig } from '@playwright/test';

const WEB_PORT = 3100;
const API_PORT = 4100;

/**
 * Browser tests on a phone-sized screen against the real API and database.
 * Requires a production build of the web app (pnpm --filter @gadmo/web build) and
 * Postgres + Redis running. CI installs Chromium; locally set PW_CHANNEL=chrome to use
 * an installed Chrome.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @gadmo/api e2e:server',
      url: `http://localhost:${API_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/offline`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
