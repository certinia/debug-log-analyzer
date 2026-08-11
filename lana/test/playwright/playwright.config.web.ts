import { createWebConfig } from '@salesforce/playwright-vscode-ext';
import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  ...createWebConfig({ testDir: './specs', workers: 1, fullyParallel: false }),
  outputDir: '../../test-results/web',
  reporter: [['html', { open: 'never', outputFolder: '../../playwright-report/web' }]],
  testMatch: '**/*.web.spec.ts',
};

export default config;
