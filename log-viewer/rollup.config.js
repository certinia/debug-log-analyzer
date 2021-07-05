// Rollup plugins
import postcss from 'rollup-plugin-postcss';
import { terser } from "rollup-plugin-terser";
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'modules/Main.js',
  output: {
    file: 'dist/bundle.js'
  },
  plugins: [
    typescript(),
    postcss({
      extensions: ['.css'],
    }),
    terser()
  ]
};
