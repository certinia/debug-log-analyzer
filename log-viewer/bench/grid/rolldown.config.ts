/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import path from 'node:path';
import url from 'node:url';

import nodePolyfills from '@rolldown/plugin-node-polyfills';
import { defineConfig } from 'rolldown';

import css from '../../../scripts/rollup-plugin-css.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));

// A classic script: Chrome will not load a module script from file://.
export default defineConfig({
  input: path.join(here, 'main.ts'),
  output: {
    file: path.join(here, 'out/main.js'),
    format: 'iife',
    codeSplitting: false,
    minify: true,
    sourcemap: false,
  },
  platform: 'browser',
  moduleTypes: { '.css': 'js', '.scss': 'js' },
  tsconfig: path.join(here, '../../tsconfig.json'),
  plugins: [nodePolyfills(), css({ minify: true })],
});
