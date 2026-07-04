import process from 'node:process';

import { defineConfig } from 'rolldown';

// rolldown plugins
import nodePolyfills from '@rolldown/plugin-node-polyfills';

// rollup plugins
import postcssUrl from 'postcss-url';
import copy from 'rollup-plugin-copy';
import postcss from 'rollup-plugin-postcss';

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
    },
    tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
    plugins: [
      nodePolyfills(),
      postcss({
        extensions: ['.css', '.scss'],
        minimize: true,
        plugins: [postcssUrl({ url: 'inline' })],
      }),
      copy({
        hook: 'closeBundle',
        targets: [
          {
            src: ['log-viewer/out/*', 'log-viewer/index.html', 'lana/certinia-icon-color.png'],
            dest: 'lana/out',
          },
        ],
      }),
    ],
  },
]);
