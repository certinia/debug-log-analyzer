import { createWebConfig } from '@salesforce/playwright-vscode-ext';
import type { PlaywrightTestConfig } from '@playwright/test';

const base = createWebConfig({ testDir: './specs', workers: 1, fullyParallel: false });

const config: PlaywrightTestConfig = {
  ...base,
  use: {
    ...base.use,
    launchOptions: {
      ...base.use?.launchOptions,
      // createWebConfig passes --disable-web-security, which turns off the checks this suite
      // exists to catch: the web build is for the Salesforce Web Console, where a CORS or CSP
      // fault is the likely failure.
      args: (base.use?.launchOptions?.args ?? []).filter((arg) => arg !== '--disable-web-security'),
    },
  },
  outputDir: '../../test-results/web',
  reporter: [['html', { open: 'never', outputFolder: '../../playwright-report/web' }]],
  testMatch: '**/*.web.spec.ts',
};

export default config;
