import { expect, type Page } from '@playwright/test';
import {
  activeQuickInputTextField,
  hasContent,
  QUICK_INPUT_WIDGET,
  webviewActiveFrame,
  WORKBENCH,
} from '@salesforce/playwright-vscode-ext';

import { LOG_FILE_NAME } from './logWorkspace';

const SHOW_ANALYSIS = 'Log: Show Apex Log Analysis';

// Not waitForVSCodeWorkbench: it loads a bare `/`, and only the URL payload can set skipWelcome.
export const openWorkbench = async (page: Page): Promise<void> => {
  const payload = encodeURIComponent(JSON.stringify([['skipWelcome', 'true']]));
  await page.goto(`/?payload=${payload}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(WORKBENCH)).toBeVisible({ timeout: 60_000 });
};

export const assertLogAnalysisRenders = async (page: Page): Promise<void> => {
  const analysis = await webviewActiveFrame(page, hasContent('log-viewer'), {
    timeout: 60_000,
  });

  const flameChart = analysis.locator('timeline-flame-chart');
  await expect(flameChart).toBeVisible({ timeout: 30_000 });

  await analysis.locator('vscode-tab-header').filter({ hasText: 'Call Tree' }).click();
  const callTree = analysis.locator('call-tree-view');
  await expect(callTree).toBeVisible();
  await expect(callTree.locator('.tabulator-row').first()).toBeVisible({ timeout: 30_000 });
};

export const openLogAnalysis = async (page: Page): Promise<void> => {
  await page.getByRole('treeitem', { name: LOG_FILE_NAME, exact: true }).dblclick();
  // The palette lists commands when it opens, and lana enables this one only once it detects the log.
  await expect(page.locator('[id="status.editor.mode"]')).toHaveText('ApexLog', {
    timeout: 60_000,
  });

  await page.keyboard.press('F1');
  await activeQuickInputTextField(page).fill(`>${SHOW_ANALYSIS}`);
  await page
    .locator(QUICK_INPUT_WIDGET)
    .getByRole('option', { name: SHOW_ANALYSIS, exact: true })
    .click();
};
