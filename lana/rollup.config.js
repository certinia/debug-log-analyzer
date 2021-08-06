import { terser } from "rollup-plugin-terser";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "rollup-plugin-typescript2";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const compact = !process.env.ROLLUP_WATCH;
const plugins = [
  nodeResolve(),
  commonjs(),
  typescript(),
  compact && terser()
];

export default {
  input: "src/Main.ts",
  output: {
    format: "cjs",
    file: "out/Main.js",
  },
  external: ["vscode"],
  plugins,
};
