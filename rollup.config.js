// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import copy from 'rollup-plugin-copy';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import postcss from 'rollup-plugin-postcss';

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
      typescript({
        tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
        exclude: ['node_modules', '**/__tests__/**'],
      }),
      production && terser(),
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
      typescript({
        tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
        exclude: ['node_modules', '**/__tests__/**'],
      }),
      postcss({
        extensions: ['.css'],
        minimize: true,
      }),
      production && terser(),
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
