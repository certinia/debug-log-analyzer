/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import path from 'node:path';
import url from 'node:url';

import { defineConfig } from 'rolldown';

const here = path.dirname(url.fileURLToPath(import.meta.url));

// The parser is aliased to its source: a Node bundle leaves a bare workspace
// package external, and nothing installs it under this directory.
export default defineConfig({
  input: path.join(here, 'measure.ts'),
  output: { file: path.join(here, 'out/measure.mjs'), format: 'esm', sourcemap: false },
  platform: 'node',
  external: [/^node:/],
  resolve: {
    alias: {
      'apex-log-parser': path.join(here, '../../apex-log-parser/src/index.ts'),
    },
  },
});
