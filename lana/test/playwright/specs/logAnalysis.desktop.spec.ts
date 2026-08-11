import {
  closeWelcomeTabs,
  waitForExtensionsActivated,
  waitForWorkspaceReady,
} from '@salesforce/playwright-vscode-ext';

import { test } from '../fixtures/desktopFixtures';
import { assertLogAnalysisRenders, openLogAnalysisFromEditorAction } from '../support/logAnalysis';

test('opens a sample log and renders its flame chart and call tree in VS Code desktop', async ({
  page,
}) => {
  await waitForWorkspaceReady(page);
  await closeWelcomeTabs(page);
  await waitForExtensionsActivated(page);
  await openLogAnalysisFromEditorAction(page);
  await assertLogAnalysisRenders(page);
});
