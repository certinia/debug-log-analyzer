/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Prints bench results side by side, one row per action, each marked against Tabulator.
 * Later files win when two hold the same contender.
 *
 *   node scripts/grid-bench/compare.mjs [results.json...]
 *
 * The Tabulator baseline of the tree the results are for is read first. `!` marks a
 * figure worse than Tabulator's, and a longest task over the 50ms budget.
 */
import { existsSync, readFileSync } from 'node:fs';

const BASELINES = {
  'time-order': 'log-viewer/bench/grid/baseline/tabulator-580k.json',
  aggregated: 'log-viewer/bench/grid/baseline/tabulator-aggregated-580k.json',
  'bottom-up': 'log-viewer/bench/grid/baseline/tabulator-bottom-up-580k.json',
};
const BUDGET_MS = 50;

const files = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const tree = Object.values(files[0] ?? {})[0]?.tree ?? 'time-order';
const baseline = existsSync(BASELINES[tree])
  ? JSON.parse(readFileSync(BASELINES[tree], 'utf8'))
  : {};
const results = Object.assign({}, baseline, ...files);
const names = Object.keys(results);
const base = results.tabulator ?? {};
const pad = (s, n = 30) => String(s).padEnd(n);
const row = (label, cells) => console.log(pad(label, 32) + cells.map((c) => pad(c)).join(''));

const BOTTOM_UP_ACTIONS = [
  'groupByType',
  'groupByNamespace',
  'ungroup',
  'sortTotalDesc',
  'clearSort',
  'expandAll',
  'find',
  'exportCsv',
  'collapseAll',
  'scrollJumpEnd',
  'scrollJumpTop',
];

const TIME_ORDER_ACTIONS = [
  'expandAll',
  'collapseAll',
  'sortSelfDesc',
  'clearSort',
  'filterOff',
  'filterOn',
  'goToDeepRow',
  'find',
  'exportCsv',
  'hideColumn',
  'showColumn',
  'scrollJumpEnd',
  'scrollJumpTop',
];

const ACTIONS =
  {
    'bottom-up': BOTTOM_UP_ACTIONS,
    aggregated: BOTTOM_UP_ACTIONS.filter((a) => !/group/i.test(a)),
  }[tree] ?? TIME_ORDER_ACTIONS;

const worse = (value, baseline) => (baseline !== undefined && value > baseline ? '!' : ' ');
const overBudget = (task) => (task > BUDGET_MS ? '!' : ' ');

row(`${tree}: ms · longest task`, names);
row(
  'firstRender (median of loads)',
  names.map((n) => {
    const r = results[n];
    const task = Math.max(...r.firstRenderRuns.map((x) => x.longestTaskMs));
    return `${worse(r.firstRenderMedianMs, base.firstRenderMedianMs)}${r.firstRenderMedianMs} · ${overBudget(task)}${task}`;
  }),
);
for (const a of ACTIONS) {
  row(
    a,
    names.map((n) => {
      const t = results[n][a];
      return t
        ? `${worse(t.ms, base[a]?.ms)}${t.ms} · ${overBudget(t.longestTaskMs)}${t.longestTaskMs}`
        : '-';
    }),
  );
}
for (const f of ['scrollFling', 'resizeNameColumn']) {
  row(
    `${f} p50/p95 dropped`,
    names.map((n) => {
      const s = results[n][f];
      return s
        ? `${s.p50}/${s.p95} ${worse(s.dropped, base[f]?.dropped)}${s.dropped}/${s.frames}`
        : '-';
    }),
  );
}
const added = (r, key) => (r[key] ?? 0) - (r.heapBeforeMountMb ?? 0);
row(
  'heap added on mount MB',
  names.map(
    (n) =>
      `${worse(added(results[n], 'heapAfterMountMb'), added(base, 'heapAfterMountMb'))}${added(results[n], 'heapAfterMountMb')}`,
  ),
);
row(
  'heap added after runs MB',
  names.map(
    (n) =>
      `${worse(added(results[n], 'heapAfterRunsMb'), added(base, 'heapAfterRunsMb'))}${added(results[n], 'heapAfterRunsMb')}`,
  ),
);
for (const k of [
  'rowsGroupedByType',
  'rowsExpanded',
  'rowsUnfiltered',
  'findMatches',
  'csvLength',
]) {
  row(
    k,
    names.map((n) => results[n][k] ?? '-'),
  );
}
