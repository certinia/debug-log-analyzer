#!/usr/bin/env node
//
// Capture the docs screenshots of the log viewer, in the dark and the light theme.
//
//   pnpm build && pnpm --filter docs-site build:demo
//   node scripts/screenshots/capture-web.mjs [outdir]
//
// It runs the built viewer through the docs demo host (lana-docs/static/demo), so
// the shots carry VS Code's real theme colours but no VS Code window. A dark shot is
// <name>.png and a light shot is <name>-light.png. The editor shots and preview.gif
// still come from capture.sh, because they need VS Code itself.
//
// governor-heap.png is not taken. Net, gross and peak are built from HEAP_ALLOCATE,
// which needs APEX_PROFILING at FINEST. sample-log.log is FINE and carries none, so the
// Call Tree Memory view would show empty columns. To take it, point build-demo at a log
// that has them, and add a shot: Call Tree, Memory view, sorted by Peak descending,
// expanded 3 levels, inspector closed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEMO = path.join(REPO, 'lana-docs/static/demo');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'lana/assets/1_24'));
const ORIGIN = 'https://demo.lana';
// The webview area of a 1920x1080 VS Code window, once the title and status bars are off.
const VIEWPORT = { width: 1920, height: 1023 };

const { chromium } = createRequire(path.join(REPO, 'package.json'))('playwright');

if (!existsSync(path.join(DEMO, 'viewer.html'))) {
  console.error(
    'capture-web: no demo build. Run "pnpm build && pnpm --filter docs-site build:demo".',
  );
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

async function openViewer(browser, theme, deviceScaleFactor) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor });
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ path: path.join(DEMO, new URL(route.request().url()).pathname) }),
  );
  await page.goto(`${ORIGIN}/viewer.html?theme=${theme}`);
  await page.locator('timeline-flame-chart').waitFor();
  await settle(page, 2000);
  return page;
}

async function settle(page, ms = 600) {
  await page.mouse.move(0, VIEWPORT.height - 1);
  await page.waitForTimeout(ms);
}

async function shoot(page, name, theme, options = {}) {
  const file = path.join(OUT, theme === 'dark' ? `${name}.png` : `${name}-light.png`);
  await page.screenshot({ path: file, ...options });
  console.log(`  ${path.basename(file)}`);
}

async function openTab(page, label) {
  await page.locator('vscode-tab-header').filter({ hasText: label }).click();
  await settle(page, 1500);
}

async function setInspector(page, open) {
  const visible = await page.locator('detail-dock').isVisible();
  if (visible !== open) {
    await page.getByTitle('Toggle Inspector').click();
    await settle(page);
  }
}

// Expands the visible tree one level per pass, so the top of the tree shows its first levels.
async function expandLevels(page, levels) {
  const toggles = page.locator('call-tree-view .twisty.closed');
  for (let level = 0; level < levels; level++) {
    const indexes = await toggles.evaluateAll((twisties) =>
      twisties
        .filter((twisty) => twisty.checkVisibility({ visibilityProperty: true }))
        .map((twisty) => Number(twisty.closest('.row').dataset.index)),
    );
    // Bottom row first: opening a row moves only the rows below it.
    for (const index of indexes.sort((a, b) => b - a)) {
      await page
        .locator(`call-tree-view .row[data-index="${index}"] .twisty.closed:visible`)
        .click();
    }
    await page.waitForTimeout(300);
  }
  // The inspector should read the whole log.
  await page.keyboard.press('Escape');
  await settle(page);
}

async function chooseView(page, label) {
  await page.locator('call-tree-view view-mode-switch').getByText(label, { exact: true }).click();
  await settle(page, 1000);
}

async function find(page, term) {
  await settle(page);
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type(term);
  await page.keyboard.press('Enter');
  // The match's card stays only while the pointer is still.
  await page.waitForTimeout(1500);
}

async function closeFind(page) {
  await page.keyboard.press('Escape');
  await settle(page);
}

// Three views side by side at 750 px each, the width the docs show them at.
async function stitch(browser, images, name, theme) {
  const page = await browser.newPage({ viewport: { width: 2250, height: 400 } });
  await page.setContent(
    `<body style="margin:0;display:flex">${images
      .map(
        (png) =>
          `<img src="data:image/png;base64,${png.toString('base64')}" style="width:750px;height:400px;display:block">`,
      )
      .join('')}</body>`,
  );
  await shoot(page, name, theme);
  await page.close();
}

async function fullShots(browser, theme) {
  const page = await openViewer(browser, theme, 1);
  await page.keyboard.press('Escape');
  await settle(page);
  await shoot(page, 'timeline', theme);

  // The find bar and the matches it lights are far apart, so this one is the whole window.
  await setInspector(page, false);
  await find(page, 'RecursiveSearcher');
  await shoot(page, 'timeline-find', theme);
  await closeFind(page);
  await setInspector(page, true);

  await openTab(page, 'Call Tree');
  await expandLevels(page, 3);
  await shoot(page, 'calltree', theme);

  // The three views get the full width, so the inspector stays closed until Analysis.
  await setInspector(page, false);
  const views = [];
  for (const label of ['Time Order', 'Aggregated', 'Bottom-Up']) {
    await chooseView(page, label);
    if (label !== 'Time Order') {
      await expandLevels(page, 3);
    }
    views.push(await page.screenshot());
  }
  await stitch(browser, views, 'calltree-combined', theme);
  await chooseView(page, 'Time Order');

  await openTab(page, 'Analysis');
  await setInspector(page, true);
  await shoot(page, 'analysis', theme);

  await openTab(page, 'Database');
  await shoot(page, 'database', theme);
  await page.close();
}

// Close-ups, at twice the pixels so they stay sharp when the docs show them large.
async function cropShots(browser, theme) {
  const page = await openViewer(browser, theme, 2);
  const chart = await page.locator('timeline-flame-chart').boundingBox();
  // The chart's column: minimap, gap, governor strip, gap, flame chart.
  const [minimap, , strip] = await page
    .locator('timeline-flame-chart')
    .evaluate((host) =>
      [
        ...[...host.shadowRoot.querySelectorAll('div')].find(
          (div) => div.style.flexDirection === 'column' && div.children.length === 5,
        ).children,
      ].map((part) => part.getBoundingClientRect().toJSON()),
    );
  const chartClip = (y, height) => ({ x: chart.x, y, width: chart.width, height });
  const toggleStrip = async () => {
    await page.keyboard.down('Shift');
    await page.mouse.click(chart.x + chart.width / 2, strip.y + 7);
    await page.keyboard.up('Shift');
  };

  await toggleStrip();
  await settle(page);
  await page.mouse.move(chart.x + chart.width * 0.75, strip.y + 50);
  await page.waitForTimeout(800);
  await shoot(page, 'timeline-gov-strip', theme, { clip: chartClip(strip.y - 2, 240) });
  await toggleStrip();

  const minimapCentre = { x: chart.x + chart.width * 0.4, y: minimap.y + minimap.height / 2 + 8 };
  await page.mouse.move(minimapCentre.x, minimapCentre.y);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('w');
    await page.waitForTimeout(200);
  }
  await page.mouse.move(minimapCentre.x + 1, minimapCentre.y);
  await page.waitForTimeout(800);
  await shoot(page, 'timeline-minimap', theme, { clip: chartClip(minimap.y, minimap.height) });
  await page.keyboard.press('0');
  await settle(page);

  await find(page, 'SELECT Id, Name');
  const card = await page.locator('timeline-flame-chart').evaluate((host) => {
    const box = [...host.shadowRoot.querySelectorAll('div')]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .find(({ el, rect }) => rect.width > 200 && getComputedStyle(el).position === 'absolute');
    return box && { x: box.rect.x, y: box.rect.y, width: box.rect.width, height: box.rect.height };
  });
  if (card) {
    await shoot(page, 'timeline-tooltip', theme, {
      clip: { x: card.x - 40, y: card.y - 40, width: card.width + 80, height: card.height + 100 },
    });
  } else {
    console.warn('  timeline-tooltip: no card showed for the match, so it was skipped');
  }
  await closeFind(page);

  await setInspector(page, false);
  await openTab(page, 'Call Tree');
  await find(page, 'core_pkg__Plugin__mdt');
  await closeFind(page);
  const row = page
    .locator('call-tree-view .row:not([hidden])')
    .filter({ hasText: 'core_pkg__Plugin__mdt' });
  const name = await row.first().locator('.cell').first().boundingBox();
  await shoot(page, 'calltree-soql-format', theme, {
    clip: { x: name.x, y: name.y - 4, width: Math.min(name.width, 700), height: name.height + 8 },
  });

  await openTab(page, 'Analysis');
  await setInspector(page, true);
  await page.keyboard.press('Escape');
  await settle(page);
  await shoot(page, 'inspector', theme, {
    clip: await page.locator('detail-dock').boundingBox(),
  });
  await page.close();
}

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  console.log(theme);
  await fullShots(browser, theme);
  await cropShots(browser, theme);
}
await browser.close();

console.log('compress');
execFileSync(path.join(REPO, 'scripts/screenshots/compress.sh'), [OUT], { stdio: 'inherit' });
