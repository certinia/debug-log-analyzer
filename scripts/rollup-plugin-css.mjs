/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

/**
 * Minimal CSS plugin for Rollup and Rolldown, which minifies with `lightningcss`.
 *
 * Each `.css` import both:
 *   - `export default`s the compiled CSS string (for Lit `unsafeCSS(styles)` shadow styles), and
 *   - injects a <style> into `document.head`.
 *
 * The head injection serves `styles/tokens.css`: its `:root` copy is the fallback a shadow
 * root inherits. A component that names a `--lana-*` token still adopts the tokens.
 */
import { readFile } from 'node:fs/promises';

import { transform as lightningTransform } from 'lightningcss';

const FILTER = /\.css$/;

const STYLE_INJECT =
  'function __inject(css){' +
  "if(typeof document==='undefined')return;" +
  "const el=document.createElement('style');el.textContent=css;document.head.appendChild(el);}";

/**
 * @param {{ minify?: boolean }} [options]
 * @returns {import('rollup').Plugin}
 */
export default function css({ minify = false } = {}) {
  return {
    name: 'lana-css',

    async load(id) {
      if (!FILTER.test(id)) {
        return null;
      }
      const source = await readFile(id, 'utf8');

      let cssText = source;

      if (minify) {
        const { code } = lightningTransform({
          filename: id,
          code: Buffer.from(cssText),
          minify: true,
          errorRecovery: true,
        });
        cssText = code.toString();
      }

      const literal = JSON.stringify(cssText);
      return {
        code: `${STYLE_INJECT}\nconst css = ${literal};\n__inject(css);\nexport default css;`,
        moduleSideEffects: true,
      };
    },
  };
}
