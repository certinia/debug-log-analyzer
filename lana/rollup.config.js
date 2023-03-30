import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

const compact = !process.env.ROLLUP_WATCH;
const plugins = [
  nodeResolve(),
  commonjs(),
  typescript({
    tsconfig: './tsconfig.json',
    exclude: ['node_modules', '**/__tests__/**'],
  }),
  compact && terser(),
];

export default {
  input: 'src/Main.ts',
  output: {
    format: 'cjs',
    file: 'out/Main.js',
    sourcemap: false,
  },
  external: ['vscode'],
  plugins,
};
