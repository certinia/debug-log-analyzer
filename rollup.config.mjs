import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import postcssUrl from 'postcss-url';
import copy from 'rollup-plugin-copy';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import postcss from 'rollup-plugin-postcss';
import { defineRollupSwcOption, swc } from 'rollup-plugin-swc3';

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
      // Copy runtime dependency files for salesforce bundle compatibility
      copy({
        targets: [
          // Pino worker files (thread-stream requires these at runtime)
          {
            src: 'node_modules/.pnpm/thread-stream@*/node_modules/thread-stream/lib/worker.js',
            dest: 'lana/out',
            rename: 'thread-stream-worker.js',
          },
          {
            src: 'node_modules/.pnpm/pino@*/node_modules/pino/lib/worker.js',
            dest: 'lana/out',
            rename: 'pino-worker.js',
          },
          {
            src: 'node_modules/.pnpm/pino@*/node_modules/pino/file.js',
            dest: 'lana/out',
            rename: 'pino-file.js',
          },
          // @salesforce/core logger transform stream (pino transport pipeline)
          {
            src: 'node_modules/.pnpm/@salesforce+core@*/node_modules/@salesforce/core/lib/logger/transformStream.js',
            dest: 'lana/out',
            rename: 'salesforce-transform-stream.js',
          },
        ],
      }),
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
      postcss({
        extensions: ['.css', '.scss'],
        minimize: true,
        // rollup-plugin-postcss only supports the legacy sass.render() API; silence its
        // deprecation warning (our SCSS itself uses the modern module system).
        use: { sass: { silenceDeprecations: ['legacy-js-api'] }, stylus: {}, less: {} },
        plugins: [postcssUrl({ url: 'inline' })],
      }),
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
