import { expect, test } from '@playwright/test';
import { filterErrors, setupConsoleMonitoring } from '@salesforce/playwright-vscode-ext';

import { assertLogAnalysisRenders, openLogAnalysis, openWorkbench } from '../support/logAnalysis';

test('opens a sample log and renders its analysis in VS Code Web', async ({ page }) => {
  // Not validateNoCriticalErrors: that helper is a no-op stub, so it passes whatever happened.
  const consoleErrors = setupConsoleMonitoring(page);

  await openWorkbench(page);
  await openLogAnalysis(page);
  await assertLogAnalysisRenders(page);

  const critical = filterErrors(consoleErrors);
  expect(critical, critical.map((error) => error.text).join('\n')).toHaveLength(0);
});
