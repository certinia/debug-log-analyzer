/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Grid bench. `index.html?c=<contender>[&tree=aggregated|bottom-up]`, then pick a log. The Time
 * Order tree is the default. `window.bench.runAll()` returns medians per action; the
 * page shows them too.
 */
import { parse, type ApexLog, type LogEvent } from '@apexdevtools/apex-log-parser';

import { LvGridAggregated } from './aggregated-contenders.js';
import { LvGridBottomUp } from './bottom-up-contenders.js';
import type { BottomUpContender, Contender, MergedContender, Mounted } from './contender.js';
import { GridContender } from './grid-contender.js';
import { callTreeContender, lvGridContender } from './lv-grid-contender.js';
import { deepEvent } from './targets.js';
import { frameStats, perFrame, settled, timed, type FrameStats, type Timing } from './timing.js';

// No contender runs Tabulator: it is gone, and `baseline/` holds the figures it last gave.
// A switch, not a lookup: CodeQL flags any call through a value found by a URL name.
function contenderFor(name: string): Contender {
  switch (name) {
    case 'grid':
      return new GridContender();
    case 'lv-grid':
      return lvGridContender();
    default:
      return callTreeContender();
  }
}

const TREES = ['time-order', 'aggregated', 'bottom-up'] as const;

const params = new URLSearchParams(location.search);
const name = params.get('c') ?? 'call-tree';
if (name === 'tabulator') {
  // Its figures would be filed as Tabulator's and replace the baseline compare.mjs reads.
  throw new Error('Tabulator is removed: baseline/ holds the figures it last gave.');
}
const tree = TREES.find((t) => t === params.get('tree')) ?? 'time-order';
const status = document.getElementById('status') as HTMLPreElement;
const host = document.getElementById('host') as HTMLDivElement;
document.title = `grid bench: ${name} ${tree}`;

const say = (text: string): void => {
  status.textContent += `${text}\n`;
  // oxlint-disable-next-line no-console -- run-bench.mjs reads progress from the console
  console.log(`[bench] ${text}`);
};

/** Heap in MB, after a collection when the runner exposes `gc`. Chrome only. */
function heapMb(): number {
  (window as unknown as { gc?: () => void }).gc?.();
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return Math.round((memory?.usedJSHeapSize ?? 0) / 1048576);
}

interface Summary {
  ms: number;
  settledMs: number;
  longestTaskMs: number;
}

const median = (xs: number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const summarise = (runs: Timing[]): Summary => ({
  ms: Math.round(median(runs.map((r) => r.ms))),
  settledMs: Math.round(median(runs.map((r) => r.settledMs))),
  longestTaskMs: Math.round(Math.max(...runs.map((r) => r.longestTaskMs))),
});

let mounted: Mounted;
let contender: Contender;
/** The Aggregated or Bottom-Up table; Bottom-Up is `grouped` too. */
let bottomUp: MergedContender;
let grouped: BottomUpContender | null = null;
let log: ApexLog;
let target: LogEvent;
const results: Record<string, unknown> = { contender: name, tree };

/** Records a timing under `key`, and says it. */
const recorder =
  (runs: Record<string, Timing[]>) =>
  (key: string, t: Timing): void => {
    (runs[key] ??= []).push(t);
    say(
      `${key} ${Math.round(t.ms)}ms settled ${Math.round(t.settledMs)}ms longest task ${Math.round(t.longestTaskMs)}ms`,
    );
  };

const frames = (list: FrameStats[]): FrameStats => ({
  frames: list[0]?.frames ?? 0,
  p50: Math.round(median(list.map((f) => f.p50)) * 10) / 10,
  p95: Math.round(median(list.map((f) => f.p95)) * 10) / 10,
  max: Math.round(Math.max(...list.map((f) => f.max))),
  dropped: median(list.map((f) => f.dropped)),
});

async function load(text: string): Promise<void> {
  const t0 = performance.now();
  log = parse(text);
  target = deepEvent(log);
  say(
    `parsed in ${Math.round(performance.now() - t0)}ms; goTo target depth event ${target.eventIndex}`,
  );
  await settled();

  if (tree === 'bottom-up') {
    grouped = new LvGridBottomUp();
    mounted = bottomUp = grouped;
  } else if (tree === 'aggregated') {
    mounted = bottomUp = new LvGridAggregated();
  } else {
    mounted = contender = contenderFor(name);
  }
  const heapBefore = heapMb();
  const first = await timed(() => mounted.mount(host, log));
  await settled(10);
  results.firstRender = summarise([first]);
  results.heapBeforeMountMb = heapBefore;
  results.heapAfterMountMb = heapMb();
  results.rowsAfterMount = mounted.visibleRowCount();
  say(`first render ${JSON.stringify(results.firstRender)} heap ${heapBefore} -> ${heapMb()}MB`);
  bench.ready = true;
}

/** Body rows only: lv-grid's header and footer are rows too, and are always in view. */
const BODY_ROW = '.body > .row:not([hidden])';

/** Whether a jump has painted rows yet, so its timing ends when they show. */
function rowsInView(scroller: HTMLElement): boolean {
  const box = scroller.getBoundingClientRect();
  return [...scroller.querySelectorAll(BODY_ROW)].some((row) => {
    const at = row.getBoundingClientRect();
    return at.height > 0 && at.bottom > box.top && at.top < box.bottom;
  });
}

/** Scrolls from the top 1500px a frame for 120 frames. */
async function fling(): Promise<FrameStats> {
  const scroller = mounted.scroller();
  scroller.scrollTop = 0;
  await settled();
  return frameStats(
    await perFrame(120, () => {
      scroller.scrollTop += 1500;
    }),
  );
}

async function scrollStats(): Promise<{ fling: FrameStats; jumpEnd: Timing; jumpTop: Timing }> {
  const scroller = mounted.scroller();
  const shown = (): boolean => rowsInView(scroller);
  const flung = await fling();
  const jumpEnd = await timed(() => {
    scroller.scrollTop = scroller.scrollHeight;
  }, shown);
  const jumpTop = await timed(() => {
    scroller.scrollTop = 0;
  }, shown);
  return { fling: flung, jumpEnd, jumpTop };
}

async function runAll(reps = 5): Promise<Record<string, unknown>> {
  if (tree !== 'time-order') {
    return runBottomUp(reps);
  }
  const runs: Record<string, Timing[]> = {};
  const flings: FrameStats[] = [];
  const resizes: FrameStats[] = [];
  const add = recorder(runs);
  let findMatches = 0;
  let csvLength = 0;

  for (let rep = 0; rep < reps; rep++) {
    add('expandAll', await timed(() => contender.expandAll()));
    results.rowsExpanded = contender.visibleRowCount();
    const scroll = await scrollStats();
    flings.push(scroll.fling);
    add('scrollJumpEnd', scroll.jumpEnd);
    add('scrollJumpTop', scroll.jumpTop);
    add('sortSelfDesc', await timed(() => contender.sortSelfDesc()));
    add('clearSort', await timed(() => contender.clearSort()));
    add('filterOff', await timed(() => contender.setDetailFilter(false)));
    results.rowsUnfiltered = contender.visibleRowCount();
    add('filterOn', await timed(() => contender.setDetailFilter(true)));
    add('find', await timed(async () => (findMatches = await contender.find('AccountService'))));
    add('exportCsv', await timed(async () => (csvLength = await contender.exportCsv())));
    add('hideColumn', await timed(() => contender.setColumnVisible('heapPeak', false)));
    add('showColumn', await timed(() => contender.setColumnVisible('heapPeak', true)));
    resizes.push(
      frameStats(
        await perFrame(60, (i) => {
          contender.setNameWidth(300 + i * 3);
        }),
      ),
    );
    add('collapseAll', await timed(() => contender.collapseAll()));
    add('goToDeepRow', await timed(() => contender.goTo(target)));
    await settled();
    say(`rep ${rep + 1}/${reps} done`);
  }

  for (const [key, list] of Object.entries(runs)) {
    results[key] = summarise(list);
  }
  results.scrollFling = frames(flings);
  results.resizeNameColumn = frames(resizes);
  results.findMatches = findMatches;
  results.csvLength = csvLength;
  results.heapAfterRunsMb = heapMb();
  say(JSON.stringify(results, null, 1));
  return results;
}

/** The Aggregated or Bottom-Up tab's actions: sorting, the tree opened, searched and exported, then Bottom-Up grouping. */
async function runBottomUp(reps: number): Promise<Record<string, unknown>> {
  const runs: Record<string, Timing[]> = {};
  const flings: FrameStats[] = [];
  const add = recorder(runs);
  let findMatches = 0;
  let csvLength = 0;

  for (let rep = 0; rep < reps; rep++) {
    add('sortTotalDesc', await timed(() => bottomUp.sortTotalDesc()));
    add('clearSort', await timed(() => bottomUp.clearSort()));
    add('expandAll', await timed(() => bottomUp.expandAll()));
    results.rowsExpanded = bottomUp.visibleRowCount();
    const scroll = await scrollStats();
    flings.push(scroll.fling);
    add('scrollJumpEnd', scroll.jumpEnd);
    add('scrollJumpTop', scroll.jumpTop);
    add('find', await timed(async () => (findMatches = await bottomUp.find('AccountService'))));
    add('exportCsv', await timed(async () => (csvLength = await bottomUp.exportCsv())));
    add('collapseAll', await timed(() => bottomUp.collapseAll()));
    await settled();
    say(`rep ${rep + 1}/${reps} done`);
  }

  // Last, as the Tabulator baseline ran them, so the figures compare.
  for (let rep = 0; grouped && rep < reps; rep++) {
    const table = grouped;
    add('groupByType', await timed(() => table.groupBy('type')));
    results.rowsGroupedByType = table.visibleRowCount();
    add('groupByNamespace', await timed(() => table.groupBy('namespace')));
  }
  if (grouped) {
    const table = grouped;
    add('ungroup', await timed(() => table.groupBy(null)));
  }

  for (const [key, list] of Object.entries(runs)) {
    results[key] = summarise(list);
  }
  results.scrollFling = frames(flings);
  results.findMatches = findMatches;
  results.csvLength = csvLength;
  results.heapAfterRunsMb = heapMb();
  say(JSON.stringify(results, null, 1));
  return results;
}

/** Times one action alone, after expanding everything so it sees every row. */
async function runOne(action: 'exportCsv' | 'find'): Promise<Record<string, unknown>> {
  await contender.expandAll();
  await settled();
  const t = await timed(() =>
    action === 'find' ? contender.find('AccountService') : contender.exportCsv(),
  );
  results[action] = summarise([t]);
  results.rowsExpanded = contender.visibleRowCount();
  say(`${action} ${JSON.stringify(results[action])} over ${contender.visibleRowCount()} rows`);
  return results;
}

const bench = {
  ready: false,
  results,
  runAll,
  runOne,
  fling,
  /** For profiling one action from outside, e.g. a fling after `expandAll`. */
  get contender(): Mounted {
    return mounted;
  },
};
(window as unknown as { bench: typeof bench }).bench = bench;

(document.getElementById('file') as HTMLInputElement).addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    say(`loading ${file.name} (${Math.round(file.size / 1048576)}MB) for ${name}`);
    void file.text().then(load);
  }
});
