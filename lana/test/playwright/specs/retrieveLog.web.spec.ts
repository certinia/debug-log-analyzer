import { test } from '@playwright/test';
import {
  executeCommandWithCommandPalette,
  waitForNotification,
} from '@salesforce/playwright-vscode-ext';

import { openWorkbench } from '../support/logAnalysis';

test('Retrieve Log reaches the Salesforce Services Apex log API', async ({ page }) => {
  await openWorkbench(page);
  await executeCommandWithCommandPalette(page, 'Log: Retrieve Apex Log And Show Analysis');

  // No org, so only a listLogs call that reached Services fails on instanceUrl; activation or API breaks fail earlier.
  await waitForNotification(page, /Error loading logfile: .*instanceUrl/, { timeout: 30_000 });
});
