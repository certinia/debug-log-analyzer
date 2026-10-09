/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Grid bench. `index.html?c=<contender>[&tree=bottom-up]`, then pick a log. The Time
 * Order tree is the default. `window.bench.runAll()` returns medians per action; the
 * page shows them too.
 */
import { parse, type ApexLog, type LogEvent } from '@apexdevtools/apex-log-parser';

import { LvGridBottomUp, TabulatorBottomUp } from './bottom-up-contenders.js';
import type { BottomUpContender, Contender, Mounted } from './contender.js';
import { GridContender } from './grid-contender.js';
import { callTreeContender, lvGridContender } from './lv-grid-contender.js';
import { TabulatorContender } from './tabulator-contender.js';
import { frameStats, perFrame, settled, timed, type FrameStats, type Timing } from './timing.js';

// A switch, not a lookup: CodeQL flags any call through a value found by a URL name.
function contenderFor(name: string): Contender {
  switch (name) {
    case 'grid':
      return new GridContender();
    case 'lv-grid':
      return lvGridContender();
    case 'call-tree':
      return callTreeContender();
    default:
      return new TabulatorContender();
  }
}

function bottomUpContenderFor(name: string): BottomUpContender {
  return name === 'call-tree' ? new LvGridBottomUp() : new TabulatorBottomUp();
}

const params = new URLSearchParams(location.search);
const name = params.get('c') ?? 'tabulator';
const tree = params.get('tree') === 'bottom-up' ? 'bottom-up' : 'time-order';
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

/** The deepest event in the middle of the log: the worst `goTo` a user can ask for. */
function deepTarget(log: ApexLog): LogEvent {
  const all: { event: LogEvent; depth: number }[] = [];
  const stack = log.children.map((event) => ({ event, depth: 0 }));
  while (stack.length) {
    const item = stack.pop() as { event: LogEvent; depth: number };
    all.push(item);
    for (const child of item.event.children) {
      stack.push({ event: child, depth: item.depth + 1 });
    }
  }
  all.sort((a, b) => a.event.eventIndex - b.event.eventIndex);
  const middle = all.slice(Math.floor(all.length * 0.45), Math.floor(all.length * 0.55));
  const best = middle.reduce((a, b) => (b.depth > a.depth ? b : a));
  return best.event;
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
let bottomUp: BottomUpContender;
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
  target = deepTarget(log);
  say(
    `parsed in ${Math.round(performance.now() - t0)}ms; goTo target depth event ${target.eventIndex}`,
  );
  await settled();

  if (tree === 'bottom-up') {
    mounted = bottomUp = bottomUpContenderFor(name);
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
const BODY_ROW = '.tabulator-row, .body > .row:not([hidden])';

/** Tabulator paints no rows on a jump of more than a viewport until the scroll stops. */
function rowsInView(scroller: HTMLElement): boolean {
  const box = scroller.getBoundingClientRect();
  return [...scroller.querySelectorAll(BODY_ROW)].some((row) => {
    const at = row.getBoundingClientRect();
    return at.height > 0 && at.bottom > box.top && at.top < box.bottom;
  });
}

async function scrollStats(): Promise<{ fling: FrameStats; jumpEnd: Timing; jumpTop: Timing }> {
  const scroller = mounted.scroller();
  const shown = (): boolean => rowsInView(scroller);
  scroller.scrollTop = 0;
  await settled();
  const fling = frameStats(
    await perFrame(120, () => {
      scroller.scrollTop += 1500;
    }),
  );
  const jumpEnd = await timed(() => {
    scroller.scrollTop = scroller.scrollHeight;
  }, shown);
  const jumpTop = await timed(() => {
    scroller.scrollTop = 0;
  }, shown);
  return { fling, jumpEnd, jumpTop };
}

async function runAll(reps = 5, skip: string[] = []): Promise<Record<string, unknown>> {
  if (tree === 'bottom-up') {
    return runBottomUp(reps, skip);
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
    if (!skip.includes('exportCsv')) {
      add('exportCsv', await timed(async () => (csvLength = await contender.exportCsv())));
    }
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

/** The Bottom-Up tab's actions: grouping, sorting, then the tree opened, searched and exported. */
async function runBottomUp(reps: number, skip: string[]): Promise<Record<string, unknown>> {
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
    if (!skip.includes('exportCsv')) {
      add('exportCsv', await timed(async () => (csvLength = await bottomUp.exportCsv())));
    }
    add('collapseAll', await timed(() => bottomUp.collapseAll()));
    await settled();
    say(`rep ${rep + 1}/${reps} done`);
  }

  // Last: Tabulator's Bottom-Up overflows the stack on an ungroup, so nothing may follow it.
  for (let rep = 0; rep < reps; rep++) {
    add('groupByType', await timed(() => bottomUp.groupBy('type')));
    results.rowsGroupedByType = bottomUp.visibleRowCount();
    add('groupByNamespace', await timed(() => bottomUp.groupBy('namespace')));
  }
  if (!skip.includes('ungroup')) {
    add('ungroup', await timed(() => bottomUp.groupBy(null)));
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
