// Rollup plugins
import postcss from "rollup-plugin-postcss";
import { terser } from "rollup-plugin-terser";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const compact = !process.env.ROLLUP_WATCH;
export default {
  input: "modules/Main.ts",
  output: {
    file: "out/bundle.js",
    sourcemap: true,
  },
  plugins: [
    nodeResolve({ preferBuiltins: false }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json" }),
    postcss({
      extensions: [".css"],
      minimize: true,
    }),
    compact && terser(),
  ],
};
