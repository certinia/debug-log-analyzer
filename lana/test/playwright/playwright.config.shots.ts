import type { PlaywrightTestConfig } from '@playwright/test';

import web from './playwright.config.web';

/** Screenshots of the log viewer for a PR or a UI check, not tests: `pnpm shots:web`. */
const config: PlaywrightTestConfig = {
  ...web,
  testDir: './shots',
  testMatch: '**/*.shots.ts',
  outputDir: '../../test-results/shots-run',
  reporter: 'list',
};

export default config;
