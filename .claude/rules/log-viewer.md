---
paths:
  - 'log-viewer/**'
---

# log-viewer rules

Webview UI.

## Boundary

- Never import `vscode` or anything from `lana/`. Message passing only.

## Performance

- Parse + render: `<5MB` in `<1s`, `10MB` in `<3s`, `20MB+` in `<5s`. Benchmark on `sample-app/` logs.
- Nothing synchronous over 50ms. Show progress over 100ms.

## Theme

- The panel is never re-created, so a theme switch is observed at runtime. HTML re-themes through
  `--vscode-*`; canvas does not — read colours via `themeObserver.on(…)` and repaint, never
  re-initialise the renderer.
- Check every change in a light and a dark theme.

## Appearance

- Write no literal colour, radius, space, shadow or border width. Use a `--lana-*` token, or the
  `--vscode-*` var the value comes from, and convert the literals in the code you touch.
- Make it a token when the role is in three or more files, is ours (`--lana-space-*`,
  `--lana-pane-min`), is a chain, `calc` or `color-mix`, or the var ships in no stable VS Code
  (`cornerRadius-*`, `spacing-size*`, `strokeThickness`). Otherwise use the var directly.
- New tokens go in `styles/tokens.css` as `var(--vscode-…, <literal>)`; the literal is what a host
  outside VS Code gets. Never end a chain in `transparent` — the value is then defined but invisible,
  and no consumer fallback can fire.
- Never define or override a `--vscode-*` name — an override is global to the webview. Exception:
  skinning a `vscode-elements` component; scope it to that element, never `:host` or `:root`.
- Data palettes stay literal: they show meaning, not chrome (`timeline/themes/Themes.ts`,
  `metric-strip/metric-strip-colors.ts`).
- A component naming a token must carry the tokens: `globalStyles`, or `tokenStyles`
  (`styles/tokens.styles.ts`) without it. The document copy styles only tabulator's body popups.

## Key paths

`features/timeline/` · `core/log-parser/` · `core/theme/ThemeObserver.ts` · `styles/tokens.css`

## Testing

- Features and fixes ship with tests. Parser format changes cover the old and the new format.
