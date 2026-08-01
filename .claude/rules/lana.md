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

## Settings

- User-visible preferences are discoverable `lana.*` settings, not hidden `globalState`.
- Setting changes reach an open panel by pushing `configChanged` — the panel sets
  `retainContextWhenHidden`, so it is never re-created and never re-reads config on its own.

## Key paths

- Commands: `lana/src/commands/`
- Config: `lana/src/workspace/AppConfig.ts`
