/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Minified and gzipped size of each table option, and of the whole webview with and
 * without Tabulator.
 *
 *   node scripts/grid-bench/size.mjs
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import nodePolyfills from '@rolldown/plugin-node-polyfills';
import { rolldown } from 'rolldown';

import css from '../rollup-plugin-css.mjs';

const sizeDir = path.resolve('log-viewer/bench/grid/size');
/** Shared by every option, so left out of each: Lit and the parser are in the webview already. */
const shared = [/^lit($|\/)/, /^@lit\//, /^@apexdevtools\//];

async function measure(label, input, external = []) {
  const bundle = await rolldown({
    input,
    platform: 'browser',
    external,
    moduleTypes: { '.css': 'js', '.scss': 'js' },
    tsconfig: path.resolve('log-viewer/tsconfig.json'),
    plugins: [nodePolyfills(), css({ minify: true })],
    logLevel: 'silent',
  });
  const { output } = await bundle.generate({ format: 'esm', minify: true, codeSplitting: false });
  const code = output.map((o) => (o.type === 'chunk' ? o.code : String(o.source))).join('');
  const kb = (n) => (n / 1024).toFixed(1).padStart(8);
  console.log(
    `${label.padEnd(44)} ${kb(Buffer.byteLength(code))}KB min ${kb(gzipSync(code).length)}KB gzip`,
  );
}

console.log('Libraries alone');
await measure(
  'tabulator-tables (core + registered modules)',
  path.join(sizeDir, 'lib-tabulator.ts'),
);
await measure('@tanstack/virtual-core', path.join(sizeDir, 'lib-virtual.ts'));
console.log('\nTime Order table layer (lit and parser excluded)');
await measure(
  'today: Tabulator + our modules + styles',
  path.join(sizeDir, 'layer-tabulator.ts'),
  shared,
);
const grid = path.resolve('log-viewer/src/grid/index.ts');
if (existsSync(grid)) {
  await measure('lv-grid: grid/index.ts', grid, shared);
}
console.log('\nWhole webview (log-viewer/src/Main.ts)');
await measure('as shipped', path.resolve('log-viewer/src/Main.ts'));
await measure('with tabulator-tables left out', path.resolve('log-viewer/src/Main.ts'), [
  /^tabulator-tables/,
]);
