// Rollup plugins
import postcss from 'rollup-plugin-postcss';
import { terser } from "rollup-plugin-terser";

export default {
  input: 'modules/Main.js',
  output: {
    file: 'dist/bundle.js'
  },
  plugins: [
    postcss({
      extensions: ['.css'],
    }),
    terser()
  ]
};