import { createWebConfig } from '@salesforce/playwright-vscode-ext';
import type { PlaywrightTestConfig } from '@playwright/test';

const base = createWebConfig({ testDir: './specs', workers: 1, fullyParallel: false });

const config: PlaywrightTestConfig = {
  ...base,
  // The base config records every CI run, which costs time on a 2-vCPU runner. A failure is recorded on its retry.
  use: {
    ...base.use,
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  outputDir: '../../test-results/web',
  reporter: [['html', { open: 'never', outputFolder: '../../playwright-report/web' }]],
  testMatch: '**/*.web.spec.ts',
};

export default config;
