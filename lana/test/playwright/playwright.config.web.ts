import { createWebConfig } from '@salesforce/playwright-vscode-ext';
import type { PlaywrightTestConfig } from '@playwright/test';

const baseConfig = createWebConfig({ testDir: './specs', workers: 1, fullyParallel: false });

const config: PlaywrightTestConfig = {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    launchOptions: {
      ...baseConfig.use?.launchOptions,
      args: [
        ...(baseConfig.use?.launchOptions?.args ?? []),
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  outputDir: '../../test-results/web',
  reporter: [['html', { open: 'never', outputFolder: '../../playwright-report/web' }]],
  testMatch: '**/*.web.spec.ts',
};

export default config;
