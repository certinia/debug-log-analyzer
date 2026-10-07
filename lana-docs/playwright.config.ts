import { defineConfig } from '@playwright/test';

// Runs against the built site, so run "pnpm build" here first.
const PORT = 3211;
const BASE_URL = `http://127.0.0.1:${PORT}/debug-log-analyzer/`;

export default defineConfig({
  testDir: './test',
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm run serve --port ${PORT} --host 127.0.0.1 --no-open`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
});
