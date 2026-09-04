import { test } from '@playwright/test';
import {
  closeWelcomeTabs,
  waitForExtensionsActivated,
  waitForVSCodeWorkbench,
  waitForWorkspaceReady,
} from '@salesforce/playwright-vscode-ext';

import { assertLogAnalysisRenders, openLogAnalysis } from '../support/logAnalysis';

test('opens a sample log and renders its analysis in VS Code Web', async ({ page }) => {
  await waitForVSCodeWorkbench(page);
  await waitForWorkspaceReady(page);
  await closeWelcomeTabs(page);
  await waitForExtensionsActivated(page);
  await openLogAnalysis(page);
  await assertLogAnalysisRenders(page);
});
