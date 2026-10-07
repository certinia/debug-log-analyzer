# grid

A virtualised tree and grouped data grid. It is built as if it were an outside library, so it
can move to its own package without change.

## Boundary

- App code imports `grid/index.ts` only.
- The grid imports no app code. App-specific cells, formatters and theme mapping live in the
  app and reach the grid as column definitions and `--grid-*` custom properties.
- Layers depend one way: `ui → render → core`.

| Layer     | Holds                                                          | May import                                 |
| --------- | -------------------------------------------------------------- | ------------------------------------------ |
| `core/`   | rows, groups, columns, totals, find, export, navigation, store | `core/` only. No packages, no DOM.         |
| `render/` | virtual row window, row elements, highlights, measuring        | `core/`, `@tanstack/virtual-core`. No Lit. |
| `ui/`     | `<lv-grid>`, header, footer, keyboard, styles                  | `core/`, `render/`, `lit`.                 |

`lana/grid-boundary` in `scripts/oxlint-plugin-lana.mjs` enforces the imports.
`core/tsconfig.json` type-checks core without the DOM library.

## Performance

Measure every change on the 580k-row log before it is committed:

- `pnpm measure grid --log <log>` for core steps, in Node.
- `pnpm bench:grid <log> <out.json> lv-grid`, then `node scripts/grid-bench/compare.mjs <out.json>`,
  for the grid in Chromium against the Tabulator baseline.

`node scripts/grid-bench/make-log.mjs 5 <log>` writes the log.
