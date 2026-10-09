/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Runs the grid bench in Chromium for each contender and writes the results.
 *
 *   node scripts/grid-bench/make-log.mjs 5 <log>          the 580k-row log the baseline used
 *   pnpm bench:grid <log> <out.json> [contender...] [--tree time-order|aggregated|bottom-up] [--loads N]
 *                   [--reps N] [--only find|exportCsv]
 *   node scripts/grid-bench/compare.mjs <out.json>        the results against the Tabulator baseline
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    loads: { type: 'string', default: '3' },
    reps: { type: 'string', default: '5' },
    only: { type: 'string' },
    tree: { type: 'string', default: 'time-order' },
  },
});
const [logPath, outPath, ...names] = positionals;
const contenders = names.length ? names : ['call-tree'];
/** Tabulator's Bottom-Up table overflows the stack on an ungroup after a group. */
const skipped = (name) => (name === 'tabulator' ? ['ungroup'] : []);

const page = `file://${path.resolve('log-viewer/bench/grid/index.html')}`;

const browser = await chromium.launch({
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
});

const all = {};
for (const name of contenders) {
  const loads = [];
  for (let load = 0; load < Number(values.loads); load++) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const tab = await context.newPage();
    tab.on('pageerror', (e) => console.log(`[${name}] ERROR ${e.message}`));
    tab.on('console', (m) => {
      if (m.text().startsWith('[bench]') || m.type() === 'error') {
        console.log(`[${name}] ${m.text()}`);
      }
    });
    await tab.goto(`${page}?c=${name}&tree=${values.tree}`);
    await tab.setInputFiles('#file', logPath);
    await tab.waitForFunction(() => window.bench?.ready, null, { timeout: 600_000, polling: 500 });
    const lastLoad = load === Number(values.loads) - 1;
    const result = values.only
      ? await tab.evaluate((only) => window.bench.runOne(only), values.only)
      : lastLoad
        ? await tab.evaluate(
            ([reps, skip]) => window.bench.runAll(reps, skip),
            [Number(values.reps), skipped(name)],
          )
        : await tab.evaluate(() => window.bench.results);
    console.log(`${name} load ${load + 1}: first render ${JSON.stringify(result.firstRender)}`);
    loads.push(structuredClone(result));
    await context.close();
  }
  const firsts = loads.map((r) => r.firstRender.ms).toSorted((a, b) => a - b);
  all[name] = {
    ...loads.at(-1),
    firstRenderRuns: loads.map((r) => r.firstRender),
    firstRenderMedianMs: firsts[Math.floor(firsts.length / 2)],
  };
  writeFileSync(outPath, JSON.stringify(all, null, 2));
}
await browser.close();
console.log(`wrote ${outPath}`);
