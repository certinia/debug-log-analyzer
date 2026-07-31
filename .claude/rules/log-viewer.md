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

## Key paths

- Parser: `apex-log-parser/src/` — shared package, so changes affect `lana/` too.
- Extension boundary: `log-viewer/src/core/messaging/VSCodeExtensionMessenger.ts`
- Timeline: `log-viewer/src/features/timeline/`. The pixi.js flame chart lives in `optimised/` —
  read its `AGENTS.md` first.
- Grid layer: `log-viewer/src/tabulator/` — wraps a patched vendored tabulator; don't edit the
  vendor file.
- Shared lit components: `log-viewer/src/components/`

## Testing

- Features and bug fixes include tests.
- Breaking changes to log parsing cover both old and new formats.
