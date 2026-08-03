---
paths:
  - 'log-viewer/**'
---

# log-viewer rules

Webview UI. Applies when working under `log-viewer/`.

## Boundary

- MUST NOT import `vscode` or anything from `lana/`.
- Communicate with the extension via message passing only.

## Performance budgets

- Parse + render: `<5MB` → `<1s`, `10MB` → `<3s`, `20MB+` → `<5s`.
- No synchronous operations >50ms blocking the extension host.
- Operations >100ms show a progress indicator.
- Benchmark against large logs from `sample-app/`.

## Theme changes

- The panel keeps its context and is never re-created, so a theme switch has to be observed at
  runtime. HTML re-themes itself through `--vscode-*`; anything drawn on a canvas does not.
  Canvas code reads its colours through `themeObserver.on(…)` and repaints, and must never
  re-initialise the renderer to do it.

## UI appearance

- **Use a `--lana-*` token for every color, radius, space, shadow and border width.** Write no new
  literals, and replace the literals in the code you touch. Older files still hold literals; we
  convert them file by file.
- **Put a new token in `styles/tokens.css` as `var(--vscode-…, <literal>)`.** The literal is the
  value a host outside VS Code gets, so one stylesheet can re-skin the app.
- **Data palettes stay literal.** The timeline categories (`timeline/themes/Themes.ts`) and the
  metric-strip tiers (`metric-strip/metric-strip-colors.ts`) show meaning, not chrome, so they do
  not follow the host theme.
- **A component that names a token must also carry the tokens.** `globalStyles` carries them, so
  `static styles = [globalStyles, …]` is enough. Without `globalStyles`, add `tokenStyles`
  (`styles/tokens.styles.ts`). The document copy, which the build injects, styles only the popups
  that tabulator puts in `document.body`.
- **Check each UI change in a light theme and in a dark theme.**

## Key paths

- Timeline: `log-viewer/src/features/timeline/`
- Parser: `log-viewer/src/core/log-parser/`
- Theme observer: `log-viewer/src/core/theme/ThemeObserver.ts`
- Tokens: `log-viewer/src/styles/tokens.css`

## Testing

- Features and bug fixes include tests.
- Breaking changes to log parsing cover both old and new formats.
