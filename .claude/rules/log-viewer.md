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

## UI appearance

- **No hardcoded colors, radii, spacing, shadows or border widths.** Consume `--lana-*`. New tokens
  go in `styles/tokens.css` as `var(--vscode-…, <literal fallback>)`. The fallback is what makes a
  standalone (non-webview) host themable — one stylesheet overriding `--lana-*` is the whole seam.
- **Data palettes are the one exception.** The timeline category palettes (`timeline/themes/Themes.ts`)
  and the metric-strip tier colors (`metric-strip/metric-strip-colors.ts`) encode meaning, not chrome,
  so they stay literal and do not follow the host theme.
- Verify in a light and a dark theme before calling a UI change done.

## Key paths

- Timeline: `log-viewer/src/features/timeline/`
- Parser: `log-viewer/src/core/log-parser/`
- Tokens: `log-viewer/src/styles/tokens.css`

## Testing

- Features and bug fixes include tests.
- Breaking changes to log parsing cover both old and new formats.
