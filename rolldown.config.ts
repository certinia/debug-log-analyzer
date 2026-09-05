import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { defineConfig } from 'rolldown';

// rolldown plugins
import nodePolyfills from '@rolldown/plugin-node-polyfills';

// rollup plugins
import copy from 'rollup-plugin-copy';

import css from './scripts/rollup-plugin-css.mjs';
import text from './scripts/rollup-plugin-text.mjs';

// Resolve the codicons dist dir via Node resolution so it works regardless of
// pnpm hoisting (avoids a hard-coded node_modules path).
const nodeRequire = createRequire(import.meta.url);
const codiconsDist = path.dirname(nodeRequire.resolve('@vscode/codicons/dist/codicon.css'));
const embeddedLogViewerPath = path.resolve('lana/build/log-viewer-embedded.js');
const webExtensionAssets = {
  'virtual:lana-log-viewer-html': { path: path.resolve('log-viewer/index.html') },
  'virtual:lana-log-viewer-script': { path: embeddedLogViewerPath },
  'virtual:lana-codicon-css': { path: path.join(codiconsDist, 'codicon.css') },
  'virtual:lana-codicon-font': {
    path: path.join(codiconsDist, 'codicon.ttf'),
    encoding: 'base64' as const,
  },
};

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
    input: { 'log-viewer-embedded': './log-viewer/src/Main.ts' },
    output: {
      format: 'esm',
      dir: './lana/build',
      entryFileNames: 'log-viewer-embedded.js',
      cleanDir: true,
      codeSplitting: false,
      sourcemap: false,
      keepNames: true,
      minify: production,
    },
    platform: 'browser',
    moduleTypes: {
      '.css': 'js',
      '.scss': 'js',
    },
    tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
    plugins: [nodePolyfills(), css({ minify: production })],
  },
  {
    input: { Main: './lana/src/Main.web.ts' },
    output: {
      format: 'cjs',
      dir: './lana/out/web',
      entryFileNames: 'Main.web.cjs',
      // The web extension host resolves only require('vscode'), so a split
      // bundle cannot load its own chunks.
      codeSplitting: false,
      sourcemap: false,
      keepNames: true,
      minify: production,
    },
    tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
    platform: 'browser',
    external: ['vscode'],
    plugins: [nodePolyfills(), text({ sources: webExtensionAssets })],
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
