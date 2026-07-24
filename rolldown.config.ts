import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { defineConfig } from 'rolldown';

// rolldown plugins
import nodePolyfills from '@rolldown/plugin-node-polyfills';

// rollup plugins
import copy from 'rollup-plugin-copy';

import css from './scripts/rollup-plugin-css.mjs';

// Resolve the codicons dist dir via Node resolution so it works regardless of
// pnpm hoisting (avoids a hard-coded node_modules path).
const nodeRequire = createRequire(import.meta.url);
const codiconsDist = path.dirname(nodeRequire.resolve('@vscode/codicons/dist/codicon.css'));

const production = process.env.NODE_ENV === 'production';
export default defineConfig([
  {
    input: './lana/src/Main.ts',
    output: {
      format: 'esm',
      dir: './lana/out',
      cleanDir: true,
      chunkFileNames: 'lana-[name].js',
      sourcemap: false,
      keepNames: true,
      minify: production,
    },
    tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
    platform: 'node',

    external: ['vscode'],
  },
  {
    input: { Main: './lana/src/Main.web.ts' },
    output: {
      format: 'esm',
      dir: './lana/out/web',
      // cleanDir omitted — desktop bundle already cleaned lana/out parent
      chunkFileNames: 'lana-[name].js',
      sourcemap: false,
      keepNames: true,
      minify: production,
    },
    tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
    platform: 'browser',

    external: ['vscode'],
    plugins: [nodePolyfills()],
  },
  {
    input: { bundle: './log-viewer/src/Main.ts' },
    output: [
      {
        format: 'esm',
        dir: './log-viewer/out',
        cleanDir: true,
        chunkFileNames: 'log-viewer-[name].js',
        sourcemap: false,
        keepNames: true,
        minify: production,
      },
    ],
    platform: 'browser',
    moduleTypes: {
      '.css': 'js',
      '.scss': 'js',
    },
    tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
    plugins: [
      nodePolyfills(),
      css({ minify: production }),
      copy({
        hook: 'closeBundle',
        targets: [
          {
            src: ['log-viewer/out/*', 'log-viewer/index.html', 'lana/certinia-icon-color.png'],
            dest: 'lana/out',
          },
          {
            src: path.join(codiconsDist, 'codicon.{css,ttf}'),
            dest: 'lana/out',
          },
        ],
      }),
    ],
  },
]);
