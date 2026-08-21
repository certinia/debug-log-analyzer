import { expect, type Page } from '@playwright/test';
import {
  executeCommandWithCommandPalette,
  hasContent,
  openFileFromExplorerTree,
  webviewActiveFrame,
} from '@salesforce/playwright-vscode-ext';

import { SAMPLE_LOG_NAME } from './logWorkspace';

export const assertLogAnalysisRenders = async (page: Page): Promise<void> => {
  const analysis = await webviewActiveFrame(page, hasContent('log-viewer'), {
    timeout: 60_000,
  });

  const flameChart = analysis.locator('timeline-flame-chart');
  await expect(flameChart).toBeVisible({ timeout: 120_000 });

  await analysis.locator('vscode-tab-header').filter({ hasText: 'Call Tree' }).click();
  const callTree = analysis.locator('call-tree-view');
  await expect(callTree).toBeVisible();
  await expect(callTree.locator('.tabulator-row').first()).toBeVisible({ timeout: 120_000 });
};

export const openLogAnalysis = async (page: Page): Promise<void> => {
  await openFileFromExplorerTree(page, SAMPLE_LOG_NAME);
  await executeCommandWithCommandPalette(page, 'Log: Show Apex Log Analysis');
};
