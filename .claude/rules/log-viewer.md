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

The UI must track every VS Code appearance change live — color theme, high contrast, and the
modern/floating-panels chrome — without reopening the panel.

- **No hardcoded colors, radii, spacing, shadows or border widths.** Consume `--lana-*`. New tokens
  go in `styles/tokens.css` as `var(--vscode-…, <literal fallback>)`. The fallback is what makes a
  standalone (non-webview) host themable — one stylesheet overriding `--lana-*` is the whole seam.
- **Every change must work in both `flat` and `cards` chrome.** Mode-specific chrome goes through
  `--lana-panel-{gap,radius,border,divider,edge}` under `:root[data-chrome='cards']` — never a second
  copy of a component's rules, and never assume one mode.
- **Data palettes are the one exception.** The timeline category palettes (`timeline/themes/Themes.ts`)
  and the metric-strip tier colors (`metric-strip/metric-strip-colors.ts`) encode meaning, not chrome,
  so they stay literal and do not follow the host theme.
- **Anything that reads a color in JS** (canvas/Pixi/`getComputedStyle`) MUST subscribe to
  `core/theme/ThemeObserver.ts` and refresh in place. Never re-initialise the renderer — tearing down
  the Pixi app on a theme switch blows the perf budget on large logs.
- **The webview cannot detect the modern chrome itself.** Nothing about the injected `--vscode-*` set
  changes when the flag flips (measured over CDP: 1005 properties, identical hash in all three toggle
  states, 0 differing). It arrives via `configChanged`; absent ⇒ `flat`.
- **Never hardcode `workbench.experimental.modernUI`.** It is an experiment and has been renamed once
  already. Detection lives solely in `AppConfig.detectModernChrome()` and matches a name _pattern_;
  `lana.appearance.chrome` is the user-facing override.
- Verify in both chrome modes, and in a light and a dark theme, before calling a UI change done.

## Key paths

- Timeline: `log-viewer/src/features/timeline/`
- Parser: `log-viewer/src/core/log-parser/`
- Tokens: `log-viewer/src/styles/tokens.css`
- Theme observer: `log-viewer/src/core/theme/ThemeObserver.ts`

## Testing

- Features and bug fixes include tests.
- Breaking changes to log parsing cover both old and new formats.
