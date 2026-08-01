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

## Key paths

- Timeline: `log-viewer/src/features/timeline/`
- Parser: `log-viewer/src/core/log-parser/`
- Theme observer: `log-viewer/src/core/theme/ThemeObserver.ts`

## Testing

- Features and bug fixes include tests.
- Breaking changes to log parsing cover both old and new formats.
