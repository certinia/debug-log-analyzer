import { expect, test } from '@playwright/test';
import {
  filterErrors,
  hasContent,
  setupConsoleMonitoring,
  webviewActiveFrame,
} from '@salesforce/playwright-vscode-ext';

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

test('a hidden tab takes no space and cannot take focus', async ({ page }) => {
  await openWorkbench(page);
  await openLogAnalysis(page);
  await assertLogAnalysisRenders(page);
  const analysis = await webviewActiveFrame(page, hasContent('log-viewer'));

  // Back to the Timeline, so the Call Tree is hidden with its content built.
  await analysis.locator('vscode-tab-header').filter({ hasText: 'Timeline' }).click();
  await expect(analysis.locator('call-tree-view')).toBeHidden();

  const panels = await analysis.locator('vscode-tabs').evaluate((tabs) =>
    [...tabs.querySelectorAll('vscode-tab-panel')].map((panel) => {
      panel.focus();
      return {
        hidden: panel.hidden,
        height: panel.hidden ? panel.getBoundingClientRect().height : 'any',
        focusable: panel.getRootNode().activeElement === panel,
      };
    }),
  );
  expect(panels).toEqual([
    { hidden: false, height: 'any', focusable: true },
    { hidden: true, height: 0, focusable: false },
    { hidden: true, height: 0, focusable: false },
    { hidden: true, height: 0, focusable: false },
  ]);
});
