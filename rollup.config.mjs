import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import { defineRollupSwcOption, swc } from 'rollup-plugin-swc3';

import css from './scripts/rollup-plugin-css.mjs';

// Resolve the codicons dist dir via Node resolution so it works regardless of
// pnpm hoisting (avoids a hard-coded node_modules path).
const nodeRequire = createRequire(import.meta.url);
const codiconsDist = path.dirname(nodeRequire.resolve('@vscode/codicons/dist/codicon.css'));

const production = process.env.NODE_ENV === 'production';
export default [
  {
    input: './lana/src/Main.ts',
    output: {
      format: 'es',
      dir: './lana/out',
      chunkFileNames: 'lana-[name].js',
      sourcemap: false,
    },

    external: ['vscode'],
    plugins: [
      // Externalize every `node:` builtin. preferBuiltins covers the ones in
      // module.builtinModules, but experimental builtins (e.g. node:sqlite, pulled in
      // transitively via undici's optional SqliteCacheStore) are excluded from that list,
      // so rollup can't resolve them. They're runtime builtins on the Node extension host —
      // this declares them external, matching rolldown's platform: 'node' behaviour.
      {
        name: 'external-node-builtins',
        resolveId: (id) => (id.startsWith('node:') ? { id, external: true } : null),
      },
      // 'node' isn't applied by default, but antlr4's exports map has only node/browser
      // conditions (no default) so it fails to resolve without it (rolldown gets this
      // from platform: 'node').
      nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
      commonjs(),
      json(),
      swc(
        defineRollupSwcOption({
          include: /\.[mc]?[jt]sx?$/,
          exclude: /node_modules/,
          tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
          jsc: {
            minify: {
              compress: production ? { keep_classnames: true, keep_fnames: true } : false,
              mangle: production ? { keep_classnames: true } : false,
            },
          },
        }),
      ),
    ],
  },
  {
    input: './lana/src/Main.web.ts',
    output: {
      format: 'es',
      dir: './lana/out/web',
      chunkFileNames: 'lana-[name].js',
      sourcemap: false,
    },

    external: ['vscode'],
    plugins: [
      // Browser bundle: no Node builtins (they don't exist on web)
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      json(),
      nodePolyfills(), // Polyfill any stray Node references
      swc(
        defineRollupSwcOption({
          include: /\.[mc]?[jt]sx?$/,
          exclude: /node_modules/,
          tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
          jsc: {
            minify: {
              compress: production ? { keep_classnames: true, keep_fnames: true } : false,
              mangle: production ? { keep_classnames: true } : false,
            },
          },
        }),
      ),
    ],
  },
  {
    input: { bundle: './log-viewer/src/Main.ts' },
    // @vscode-elements ships tsc output with the inline `(this && this.__decorate)` helper.
    // Declaring a top-level `this` for those files stops rollup's THIS_IS_UNDEFINED warning; use
    // `globalThis` (a real binding rollup won't flag) — `globalThis.__decorate` is undefined so the
    // guard still falls back to the inline helper, i.e. no behaviour change.
    moduleContext: (id) => (id.includes('/@vscode-elements/elements/') ? 'globalThis' : undefined),
    output: [
      {
        format: 'es',
        dir: './log-viewer/out',
        chunkFileNames: 'log-viewer-[name].js',
        sourcemap: false,
      },
    ],
    plugins: [
      nodeResolve({
        browser: true,
        preferBuiltins: false,
      }),
      commonjs(),
      nodePolyfills(),
      swc(
        defineRollupSwcOption({
          // All options are optional
          include: /\.[mc]?[jt]sx?$/,
          exclude: /node_modules/,
          tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
          jsc: {
            transform: { useDefineForClassFields: false },
            minify: {
              compress: production,
              mangle: production
                ? {
                    keep_classnames: true,
                  }
                : false,
            },
          },
        }),
      ),
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
];
