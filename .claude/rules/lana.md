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

- **Give every user preference a `lana.*` setting.** Do not hide it in `globalState`.
- **Remembered UI state is not a preference.** The view a table was last left in, the inspector's
  section layout, column overrides: these persist privately in `globalState` — see
  `PRIVATE_SECTIONS` in `AppConfig.ts` — and are not registered settings.
- **Push `configChanged` to an open panel when a setting changes.** The panel sets
  `retainContextWhenHidden`, so it is never re-created and never re-reads the config itself.

## Key paths

- Commands: `lana/src/commands/`
- Config: `lana/src/workspace/AppConfig.ts`
