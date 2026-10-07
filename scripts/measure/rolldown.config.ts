/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import path from 'node:path';
import url from 'node:url';

import { defineConfig } from 'rolldown';

const here = path.dirname(url.fileURLToPath(import.meta.url));

export default defineConfig({
  input: path.join(here, 'measure.ts'),
  output: {
    file: path.join(here, 'out/measure.mjs'),
    format: 'esm',
    sourcemap: false,
    // The SOQL linter loads lazily; one file keeps `output.file` valid.
    codeSplitting: false,
  },
  platform: 'node',
  external: [/^node:/],
});
