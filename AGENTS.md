# Context

**Apex Log Analyzer** - VS Code extension for analyzing Salesforce debug logs with interactive visualizations (flame charts, call trees, SOQL/DML breakdowns).

## Monorepo Structure

- lana/: VS Code extension (TypeScript)
- log-viewer/: Webview UI (TypeScript)
- lana-docs-site/: Docusaurus documentation
- sample-app/: Sample Salesforce app with test logs

## Technology + Tooling

- TypeScript
- lit, html, css, js

Always use pnpm

## Key Commands

- pnpm watch: Dev build with hot reload
- pnpm build: Production build
- pnpm test: Run tests before commiting
- pnpm lint: Type + lint check
- pnpm prettier-format: Auto-format all files

## Development Guidelines

- Strict TypeScript enabled
- `log-viewer/` + `lana/` must remain independent + `log-viewer/` can not import VSCode APIs
- Write tests first (TDD)
- Fast performance + Handle 50MB+ logs (500k+ lines)

## Important notes

- See `.specify/memory/constitution.md` for Core principles, development standards, Release process
- Conventional commit messages
- Don't auto commit
