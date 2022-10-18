// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import postcss from 'rollup-plugin-postcss';
import { terser } from 'rollup-plugin-terser';
import typescript from '@rollup/plugin-typescript';
import copy from 'rollup-plugin-copy';

const compact = !process.env.ROLLUP_WATCH;
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
        tsconfig: './lana/tsconfig.json',
      }),
      compact && terser(),
    ],
  },
  {
    input: './log-viewer/modules/Main.ts',
    output: [
      {
        file: './log-viewer/out/bundle.js',
        sourcemap: false,
      },
    ],
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './log-viewer/tsconfig.json',
      }),
      postcss({
        extensions: ['.css'],
        minimize: true,
      }),
      compact && terser(),
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
