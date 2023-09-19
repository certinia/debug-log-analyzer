// Rollup plugins
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import postcss from 'rollup-plugin-postcss';
import {
  defineRollupSwcMinifyOption,
  defineRollupSwcOption,
  minify,
  swc,
} from 'rollup-plugin-swc3';

const production = !process.env.ROLLUP_WATCH;
export default {
  input: 'modules/Main.ts',
  output: {
    file: 'out/bundle.js',
    sourcemap: false,
  },
  plugins: [
    nodeResolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    nodePolyfills(),
    swc(
      defineRollupSwcOption({
        exclude: 'node_modules',
        tsconfig: production ? 'tsconfig.json' : 'tsconfig-dev.json',
        jsc: {},
      })
    ),
    postcss({
      extensions: ['.css', '.scss'],
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
  ],
};
