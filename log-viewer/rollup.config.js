// Rollup plugins
import postcss from 'rollup-plugin-postcss';
import { terser } from "rollup-plugin-terser";
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'modules/Main.ts',
  output: {
    file: 'bundle.js'
  },
  plugins: [
    commonjs(),
    nodeResolve({ preferBuiltins: false }),
    typescript(),
    postcss({
      extensions: ['.css'],
    }),
    terser()
  ]
};
