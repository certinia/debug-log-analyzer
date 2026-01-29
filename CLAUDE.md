# Apex Log Analyzer

VS Code extension for Salesforce debug log analysis.

## Structure

- `lana/` - VS Code extension
- `log-viewer/` - Webview UI (NO vscode imports allowed)

## Commands

pnpm watch | build | test | lint | prettier-format

## Standards

See `.specify/memory/constitution.md` for full guidelines.

- Strict TypeScript, no `any`
- Performance: <3s for 10MB logs
- Tests required for features
- Conventional commits, no auto-commit
