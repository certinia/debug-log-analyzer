/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Writes a large log by repeating the sample log's execution, so a grid bench runs
 * real parser output at a chosen row count.
 *
 *   node scripts/grid-bench/make-log.mjs <copies> <out>
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { parse } from '@apexdevtools/apex-log-parser';

const [copies = '5', out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/grid-bench/make-log.mjs <copies> <out>');
  process.exit(1);
}

const lines = readFileSync('sample-app/debug-logs/sample-log.log', 'utf8').split('\n');
const start = lines.findIndex((l) => l.includes('|EXECUTION_STARTED'));
const end = lines.findLastIndex((l) => l.includes('|EXECUTION_FINISHED'));
const head = lines.slice(0, start);
const body = lines.slice(start, end + 1);
const tail = lines.slice(end + 1);

const stamp = /^(\S+ )\((\d+)\)\|/;
const lastNs = Number(stamp.exec(body.at(-1))[2]);

const result = [...head];
for (let copy = 0; copy < Number(copies); copy++) {
  const offset = copy * (lastNs + 1000);
  // A fraction keeps the first part of the execution: the parser closes what is left open.
  const part = Math.min(1, Number(copies) - copy);
  for (const l of body.slice(0, Math.ceil(body.length * part))) {
    result.push(
      offset ? l.replace(stamp, (_m, clock, ns) => `${clock}(${Number(ns) + offset})|`) : l,
    );
  }
}
result.push(...tail);
const text = result.join('\n');
writeFileSync(out, text);

const log = parse(text);
let rows = 0;
const stack = [...log.children];
while (stack.length) {
  const e = stack.pop();
  rows++;
  stack.push(...e.children);
}
console.log(`${out}: ${(text.length / 1048576).toFixed(1)}MB, ${rows} call tree rows`);
