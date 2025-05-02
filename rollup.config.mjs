// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import postcss from 'rollup-plugin-postcss';
import { defineRollupSwcOption, swc } from 'rollup-plugin-swc3';

const production = process.env.NODE_ENV === 'production';
console.log('Package mode:', production ? 'production' : 'development');
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
      nodeResolve({ preferBuiltins: true, dedupe: ['@salesforce/core'] }),
      commonjs(),
      json(),
      swc(
        defineRollupSwcOption({
          include: /\.[mc]?[jt]sx?$/,
          exclude: 'node_modules',
          tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
          jsc: {
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
    ],
  },
  {
    input: { bundle: './log-viewer/modules/Main.ts' },
    output: [
      {
        format: 'es',
        dir: './log-viewer/out',
        chunkFileNames: 'log-viewer-[name].js',
        sourcemap: false,
      },
    ],
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      nodePolyfills(),
      swc(
        defineRollupSwcOption({
          // All options are optional
          include: /\.[mc]?[jt]sx?$/,
          exclude: 'node_modules',
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
      }),
      copy({
        hook: 'closeBundle',
        targets: [
          {
            src: [
              'log-viewer/out/*',
              'log-viewer/index.html',
              'lana/certinia-icon-color.png',
              'node_modules/@vscode/codicons/dist/codicon.ttf',
            ],
            dest: 'lana/out',
          },
          { src: ['CHANGELOG.md', 'LICENSE.txt', 'README.md'], dest: 'lana' },
        ],
      }),
    ],
  },
];
