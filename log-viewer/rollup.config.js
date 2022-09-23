// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import postcss from 'rollup-plugin-postcss';
import { terser } from 'rollup-plugin-terser';
import typescript from '@rollup/plugin-typescript';

const compact = !process.env.ROLLUP_WATCH;
export default {
  input: 'modules/Main.ts',
  output: {
    file: 'out/bundle.js',
    sourcemap: false,
  },
  plugins: [
    nodeResolve(),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      exclude: ['node_modules', '**/__tests__/**'],
    }),
    postcss({
      extensions: ['.css'],
      minimize: true,
    }),
    compact && terser(),
  ],
};
