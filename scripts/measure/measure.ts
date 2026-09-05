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
import { parseArgs } from 'node:util';

import { type ApexLog, parse } from 'apex-log-parser';

import { measureCallTree } from './call-tree.js';
import { die, time } from './harness.js';
import { digestMinimap, measureMinimap } from './minimap.js';
import { measureVariables } from './variables.js';
import { measureWindow } from './window.js';

/** The one log every measurement runs over, so the numbers compare across branches. */
const SAMPLE_LOG = 'sample-app/debug-logs/sample-log.log';

const USAGE = 'usage: pnpm measure [area...] [--log <path>] [--digest]';

interface Area {
  run(log: ApexLog): Promise<void>;
  /** Prints a CSV of what the area would draw. Absent where timings are all there is. */
  digest?(log: ApexLog): void;
}

const AREAS: Record<string, Area> = {
  'call-tree': { run: measureCallTree },
  minimap: { run: measureMinimap, digest: digestMinimap },
  variables: { run: measureVariables },
  window: { run: measureWindow },
};

const args = (() => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: { log: { type: 'string' }, digest: { type: 'boolean', default: false } },
      allowPositionals: true,
    });
  } catch (error) {
    die(`${(error as Error).message}\n${USAGE}`);
  }
})();

const digest = args.values.digest === true;
const logPath = args.values.log ?? SAMPLE_LOG;

// Named areas, or every area that can answer. A digest of timings would corrupt the CSV.
const names = args.positionals.length
  ? args.positionals
  : Object.keys(AREAS).filter((name) => !digest || AREAS[name]!.digest);

for (const name of names) {
  const area = AREAS[name];
  if (!area) {
    die(`unknown area "${name}". Known: ${Object.keys(AREAS).join(', ')}\n${USAGE}`);
  }
  if (digest && !area.digest) {
    die(`no digest for: ${name}\n${USAGE}`);
  }
}

// Each digest prints its own CSV header, so two into one stdout is not a CSV.
if (digest && names.length > 1) {
  die(`name one area to digest: ${names.join(', ')}\n${USAGE}`);
}

let text: string;
try {
  text = readFileSync(logPath, 'utf8');
} catch (error) {
  die(`${(error as Error).message}\n${USAGE}`);
}
if (!digest) {
  console.log(`log ${Math.round(text.length / 1048576)}MB, ${text.split('\n').length} lines\n`);
}
const log = digest ? parse(text) : await time('parse', () => parse(text));

for (const name of names) {
  const area = AREAS[name]!;
  if (digest && area.digest) {
    area.digest(log);
    continue;
  }
  console.log(`\n--- ${name} ---`);
  await area.run(log);
}
