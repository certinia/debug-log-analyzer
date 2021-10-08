// Rollup plugins
import postcss from "rollup-plugin-postcss";
import { terser } from "rollup-plugin-terser";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "modules/Main.ts",
  output: {
    file: "bundle.js",
  },
  plugins: [
    typescript(),
    postcss({
      extensions: [".css"],
      minimize: true,
    }),
    terser(),
  ],
};
