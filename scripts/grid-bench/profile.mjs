/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * CPU-profiles one bench action for one contender and prints the functions with the most
 * self time. `fling` (the default) scrolls fast with every row expanded and also prints
 * frame times; `mount` covers loading the log, parse included.
 *
 *   pnpm exec rolldown -c log-viewer/bench/grid/rolldown.config.ts
 *   node scripts/grid-bench/profile.mjs <log> [contender] [fling|mount]
 */
import path from 'node:path';

import { chromium } from 'playwright';

const [logPath, name = 'grid', action = 'fling'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('ERROR', e.message));
await page.goto(`file://${path.resolve('log-viewer/bench/grid/index.html')}?c=${name}`);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });

if (action === 'mount') {
  // The bench waits a few frames between parse and mount, so this starts in between.
  page.on('console', (m) => {
    if (m.text().startsWith('[bench] parsed')) {
      void cdp.send('Profiler.start');
    }
  });
}
await page.setInputFiles('#file', logPath);
await page.waitForFunction(() => window.bench?.ready, null, { timeout: 600_000, polling: 500 });
if (action === 'fling') {
  await page.evaluate(() => window.bench.contender.expandAll());
  await cdp.send('Profiler.start');
}
const frames =
  action !== 'fling'
    ? []
    : await page.evaluate(async () => {
        const scroller = window.bench.contender.scroller();
        scroller.scrollTop = 0;
        const times = [];
        let last = performance.now();
        for (let i = 0; i < 120; i++) {
          scroller.scrollTop += 1500;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const now = performance.now();
          times.push(now - last);
          last = now;
        }
        return times;
      });
const { profile } = await cdp.send('Profiler.stop');

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((id, i) => {
  const f = byId.get(id).callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i + 1] ?? 0));
});
if (frames.length) {
  const sorted = frames.toSorted((a, b) => a - b);
  console.log(
    `frames p50 ${sorted[60].toFixed(1)}ms p95 ${sorted[114].toFixed(1)}ms, ${frames.filter((t) => t > 25).length} of 120 over 25ms`,
  );
}
for (const [key, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  console.log(`${(us / 1000).toFixed(1).padStart(8)}ms  ${key}`);
}
await browser.close();
