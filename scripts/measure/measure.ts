/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the paths that have to hold up on a large log.
 *
 * They are free of the DOM and of PixiJS, so they run under Node: a browser
 * cannot profile a 100MB log without its own parse blocking the tools.
 *
 *   pnpm measure                      every area, on the committed sample log
 *   pnpm measure minimap              one area
 *   pnpm measure --log <path>         another log
 *   pnpm measure minimap --digest     CSV of what the minimap would draw
 *
 * One area per feature that has a performance budget, and one number each for
 * what a user waits on. Heap figures need `--expose-gc`, which the `measure`
 * script passes.
 */
import { readFileSync } from 'node:fs';

import { type ApexLog, parse } from 'apex-log-parser';

import { measureCallTree } from './call-tree.js';
import { time } from './harness.js';
import { measureMinimap } from './minimap.js';

/** The one log every measurement runs over, so the numbers compare across branches. */
const SAMPLE_LOG = 'sample-app/debug-logs/sample-log.log';

type AreaRun = (log: ApexLog, digest: boolean) => Promise<void>;

const AREAS: Record<string, AreaRun> = {
  'call-tree': measureCallTree,
  minimap: measureMinimap,
};

/** Areas that can print a digest. Anything else would corrupt the CSV with timings. */
const DIGESTABLE = ['minimap'];

const argv = process.argv.slice(2);
const digest = argv.includes('--digest');

const logAt = argv.indexOf('--log');
const logPath = logAt === -1 ? SAMPLE_LOG : argv[logAt + 1];
if (!logPath) {
  console.error('usage: pnpm measure [area...] [--log <path>] [--digest]');
  process.exit(1);
}

const known = Object.keys(AREAS).join(', ');
// `logAt === -1` would make the path index 0 and swallow the first area name.
const pathAt = logAt === -1 ? -1 : logAt + 1;
const named = argv.filter((arg, at) => !arg.startsWith('--') && at !== pathAt);
for (const name of named) {
  if (!(name in AREAS)) {
    console.error(`unknown area "${name}". Known: ${known}`);
    process.exit(1);
  }
}

const areas = named.length ? named : digest ? DIGESTABLE : Object.keys(AREAS);
const undigestable = digest ? areas.filter((name) => !DIGESTABLE.includes(name)) : [];
if (undigestable.length) {
  console.error(`no digest for: ${undigestable.join(', ')}. Digestable: ${DIGESTABLE.join(', ')}`);
  process.exit(1);
}

const text = readFileSync(logPath, 'utf8');
if (!digest) {
  console.log(`log ${Math.round(text.length / 1048576)}MB, ${text.split('\n').length} lines\n`);
}
const log = digest ? parse(text) : await time('parse', () => parse(text));

for (const area of areas) {
  if (!digest) {
    console.log(`\n--- ${area} ---`);
  }
  await AREAS[area]!(log, digest);
}
