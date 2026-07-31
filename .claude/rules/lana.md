---
paths:
  - 'lana/**'
---

# lana rules

VS Code extension. Applies when working under `lana/`.

## UX

- Major features reachable via Command Palette, context menus, and code lenses.
- Error messages are actionable with clear next steps.
- Full keyboard navigation for accessibility.

## Settings and appearance

- User-visible preferences are discoverable `lana.*` settings, not hidden `globalState`.
- Setting changes reach an open panel by pushing `configChanged` — the panel sets
  `retainContextWhenHidden`, so it is never re-created and never re-reads config on its own.
- Never hardcode `workbench.experimental.modernUI`. It is an experiment and has been renamed once
  already; `AppConfig.detectModernChrome()` matches a name _pattern_ over the `workbench` config tree
  so a rename needs no release. `lana.appearance.chrome` is the user-facing override.

## Key paths

- Commands: `lana/src/commands/`
- Config: `lana/src/workspace/AppConfig.ts`
