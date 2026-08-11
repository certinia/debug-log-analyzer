import { createDesktopConfig } from '@salesforce/playwright-vscode-ext';
import type { PlaywrightTestConfig } from '@playwright/test';

process.env.VSCODE_DESKTOP = '1';

const config: PlaywrightTestConfig = {
  ...createDesktopConfig({
    testDir: './specs',
    workers: 1,
    fullyParallel: false,
    timeout: 180_000,
  }),
  globalSetup: undefined,
  outputDir: '../../test-results/desktop',
  reporter: [['html', { open: 'never', outputFolder: '../../playwright-report/desktop' }]],
  testMatch: '**/*.desktop.spec.ts',
};

export default config;
