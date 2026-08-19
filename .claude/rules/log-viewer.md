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

- **Never write a raw literal for a color, radius, space, shadow or border width.** Use a
  `--lana-*` token, or the `--vscode-*` var the value comes from. Replace the literals in the code
  you touch; older files still hold them and we convert file by file.
- **A `--lana-*` token when the value is more than one var, and the plain `--vscode-*` var when it
  is not.** Give a value a token when any of these holds:
  1. the role appears in three or more files;
  2. VS Code has no var for it, so it is a scale or a role of ours (`--lana-space-*`,
     `--lana-pane-min`);
  3. the value is a chain, a `calc` or a `color-mix`, not a single var;
  4. the var is absent in a VS Code we support, so a fallback is needed — `cornerRadius-*`,
     `spacing-size*` and `strokeThickness` ship in no stable release.

  Otherwise use the var directly. A token wrapping one already-semantic var used in one file
  (`--vscode-editorCursor-foreground`) only adds a name to learn and a hop to trace.

- **Put a new token in `styles/tokens.css` as `var(--vscode-…, <literal>)`.** The literal is what a
  host outside VS Code falls back to, and what covers a var VS Code has yet to register.
- **Never define or override a `--vscode-*` name.** An override is global to the webview, so
  re-skinning one role changes every other consumer of that var, and shadowing a platform name
  leaves no way to tell what the var means. A host outside VS Code supplies the whole `--vscode-*`
  block once instead. The one exception is skinning a `vscode-elements` component, which reads its
  own `--vscode-*` names: scope the override to that element, never to `:host` or `:root`.
- **Never write a literal font size or family.** Take a step from the type ramp in
  `styles/tokens.css` (`--lana-text-*`, with `--lana-text-mono` for editor-sized text and
  `--lana-text-meta` for header metadata), and a family from `--lana-font-mono` or
  `--lana-font-ui`.
- **Mono is for text whose alignment carries meaning** — stacks, code, log text. Prose takes the UI
  font.
- **An all-caps run takes `--lana-text-caps` and `--lana-text-caps-tracking`.** Every glyph reaches
  cap height, so caps read a size larger and step one down.
- **Two exemptions.** A PIXI `fontSize` is a number and cannot read a var, and the codicon rule in
  `DataGrid.scss` sizes a glyph box, not text.
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
