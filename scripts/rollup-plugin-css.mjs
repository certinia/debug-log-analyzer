/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

/**
 * Minimal CSS/SCSS plugin for Rollup and Rolldown, built on modern primitives:
 * `sass` (modern compileString API — no legacy JS API) and `lightningcss` (minify).
 *
 * Each `.scss`/`.css` import both:
 *   - `export default`s the compiled CSS string (for Lit `unsafeCSS(styles)` shadow styles), and
 *   - injects a <style> into `document.head`.
 *
 * The head injection is load-bearing: tabulator appends tooltips and edit-list popups to
 * `document.body` (light DOM) when no `popupContainer` is set, so those popups are only styled
 * by the document-level <style>, not by the shadow-root `unsafeCSS` copy.
 *
 * SCSS resolves bare `node_modules` specifiers (e.g. `tabulator-tables/...`) via `loadPaths`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transform as lightningTransform } from 'lightningcss';
import { compileStringAsync } from 'sass';

const FILTER = /\.(scss|css)$/;
const nodeModules = path.resolve('node_modules');

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
      if (id.endsWith('.scss')) {
        const result = await compileStringAsync(source, {
          syntax: 'scss',
          url: pathToFileURL(id),
          loadPaths: [nodeModules],
          style: 'expanded',
        });
        cssText = result.css;
        // keep watch mode aware of @use/@forward/meta.load-css dependencies
        for (const url of result.loadedUrls) {
          if (url.protocol === 'file:') {
            this.addWatchFile(fileURLToPath(url));
          }
        }
      }

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
