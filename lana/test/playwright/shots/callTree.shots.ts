import path from 'node:path';

import { expect, test, type Locator } from '@playwright/test';
import { hasContent, webviewActiveFrame } from '@salesforce/playwright-vscode-ext';

import { openLogAnalysis, openWorkbench } from '../support/logAnalysis';
import { extensionRoot } from '../support/paths';

const OUT = process.env.LANA_SHOTS_DIR ?? path.join(extensionRoot, 'test-results', 'shots');

const shoot = (target: Locator, name: string): Promise<Buffer> =>
  target.screenshot({ path: path.join(OUT, `${name}.png`) });

test('call tree', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 800 });
  await openWorkbench(page);
  await openLogAnalysis(page);
  const analysis = await webviewActiveFrame(page, hasContent('log-viewer'), { timeout: 60_000 });
  await expect(analysis.locator('timeline-flame-chart')).toBeVisible({ timeout: 30_000 });

  await analysis.locator('vscode-tab-header').filter({ hasText: 'Call Tree' }).click();
  const callTree = analysis.locator('call-tree-view');
  const rows = callTree.locator('[role="row"][data-index]:not([hidden])');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await shoot(callTree, 'call-tree');

  // The expand split button, then its menu. CSS locators reach into open shadow roots.
  const expand = callTree.locator('tree-expand-button');
  const before = await rows.count();
  await expand.locator('button.header-control').first().click();
  await expect(rows).not.toHaveCount(before);
  await shoot(callTree, 'call-tree-one-level');

  await expand.locator('.more').click();
  await expect(expand.locator('#menu')).toBeVisible();
  await shoot(callTree, 'call-tree-expand-menu');
});
