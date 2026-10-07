import { expect, test } from '@playwright/test';

// Guards the contract between demo/host.js and the viewer: if the viewer asks for something
// the host no longer answers, the demo stops rendering and this fails.
test('the homepage live demo loads on click, follows the theme and closes', async ({ page }) => {
  const demoRequests: string[] = [];
  const demoErrors: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/demo/')) {
      demoRequests.push(request.url());
    }
  });
  // Only the demo's own errors: the page also calls the GitHub API, which CI can be refused.
  page.on('console', (message) => {
    if (message.type() === 'error' && message.location().url.includes('/demo/')) {
      demoErrors.push(message.text());
    }
  });

  await page.goto('./');
  await page.waitForLoadState('networkidle');
  expect(demoRequests, 'the demo loads before the click').toHaveLength(0);

  await page.getByRole('button', { name: 'Open demo' }).click();
  const demo = page.frameLocator('iframe[title="Apex Log Analyzer live demo"]');
  await expect(demo.locator('timeline-flame-chart')).toBeVisible({ timeout: 30_000 });
  await expect(demo.locator('detail-dock')).toBeVisible();

  const themeKind = demo.locator('body');
  await expect(themeKind).toHaveAttribute('data-vscode-theme-kind', 'vscode-dark');
  await page.getByRole('button', { name: /Switch between dark and light mode/ }).click();
  await expect(themeKind).toHaveAttribute('data-vscode-theme-kind', 'vscode-light');

  await demo.locator('vscode-tab-header').filter({ hasText: 'Call Tree' }).click();
  await expect(demo.locator('call-tree-view .tabulator-row').first()).toBeVisible({
    timeout: 30_000,
  });

  await page.locator('iframe').scrollIntoViewIfNeeded();
  const frame = await page.locator('iframe').boundingBox();
  if (!frame) {
    throw new Error('The demo frame has no box.');
  }
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 400);
  }
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY), 'a scroll in the demo moved the page').toBe(
    scrollBefore,
  );

  await page.getByRole('button', { name: 'Close demo' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(demoErrors).toEqual([]);
});
