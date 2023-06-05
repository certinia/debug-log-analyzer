import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

import {
  defineRollupSwcOption,
  swc,
  minify,
  defineRollupSwcMinifyOption,
} from 'rollup-plugin-swc3';

const production = !process.env.ROLLUP_WATCH;
const plugins = [
  nodeResolve(),
  commonjs(),
  swc(
    defineRollupSwcOption({
      exclude: 'node_modules',
      tsconfig: production ? 'tsconfig.json' : 'tsconfig-dev.json',
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
