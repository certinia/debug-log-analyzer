// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import pkgMinifyHTML from 'rollup-plugin-minify-html-literals';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import postcss from 'rollup-plugin-postcss';
import {
  defineRollupSwcMinifyOption,
  defineRollupSwcOption,
  minify,
  swc,
} from 'rollup-plugin-swc3';

const minifyHTML = pkgMinifyHTML.default;

const production = process.env.NODE_ENV == 'production';
console.log('Package mode:', production ? 'production' : 'development');
export default [
  {
    input: './lana/src/Main.ts',
    output: {
      format: 'cjs',
      file: './lana/out/Main.js',
      sourcemap: false,
    },
    external: ['vscode'],
    plugins: [
      nodeResolve(),
      commonjs(),
      swc(
        defineRollupSwcOption({
          include: /\.[mc]?[jt]sx?$/,
          exclude: 'node_modules',
          tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
          jsc: {},
        })
      ),
      production &&
        minify(
          defineRollupSwcMinifyOption({
            // swc's minify option here
            mangle: true,
            compress: true,
          })
        ),
    ],
  },
  {
    input: './log-viewer/modules/Main.ts',
    output: [
      {
        format: 'es',
        file: './log-viewer/out/bundle.js',
        sourcemap: false,
      },
    ],
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      nodePolyfills(),
      minifyHTML(),
      swc(
        defineRollupSwcOption({
          // All options are optional
          include: /\.[mc]?[jt]sx?$/,
          exclude: 'node_modules',
          tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
          jsc: {},
        })
      ),
      postcss({
        extensions: ['.css'],
        minimize: true,
      }),

      production &&
        minify(
          defineRollupSwcMinifyOption({
            // swc's minify option here
            mangle: true,
            compress: true,
          })
        ),
      copy({
        hook: 'writeBundle',
        targets: [
          { src: 'log-viewer/out/*', dest: 'lana/out' },
          { src: ['CHANGELOG.md', 'LICENSE.txt', 'README.md'], dest: 'lana' },
        ],
      }),
    ],
  },
];
