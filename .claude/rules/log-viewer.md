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

- Timeline: `log-viewer/src/features/timeline/`
- Parser: `log-viewer/src/core/log-parser/`

## Testing

- Features and bug fixes include tests.
- Breaking changes to log parsing cover both old and new formats.
