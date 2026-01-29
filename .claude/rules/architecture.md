# Architecture

## Package Boundaries

- `log-viewer/` MUST NOT import `vscode` or anything from `lana/`
- lana ↔ log-viewer communication via message passing only

## Key Paths

- Timeline: log-viewer/src/features/timeline/
- Parser: log-viewer/src/core/log-parser/
- Commands: lana/src/commands/
- Tests: _/**tests**/ or _.test.ts
