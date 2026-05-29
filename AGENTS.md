# Apex Log Analyzer

VS Code extension for analyzing Salesforce debug logs with interactive visualizations
(flame charts, call trees, SOQL/DML breakdowns).

> Canonical agent instructions for all tools. Claude Code loads this via `CLAUDE.md`.
> Area-specific rules live in `.claude/rules/` — see the Rules manifest below.

## Monorepo structure

- `lana/` — VS Code extension (TypeScript)
- `log-viewer/` — webview UI (TypeScript; lit / html / css)
- `lana-docs/` — Docusaurus documentation
- `sample-app/` — sample Salesforce app with test logs

## Commands

Always use pnpm.

- `pnpm watch` — dev build with hot reload
- `pnpm build` — production build
- `pnpm test` — run tests (before committing)
- `pnpm lint` — type + lint check
- `pnpm prettier-format` — auto-format

## Core principles

- **Type safety** — strict TypeScript, no `any` (use `unknown` + justification if unavoidable).
- **Modularity** — keep `lana/` and `log-viewer/` independent; cross-package contracts only.
- **Performance** — handle large logs (50MB+, 500k+ lines) without blocking the UI.
- **UX** — discoverable, accessible, actionable errors.
- **Testing** — features and bug fixes ship with tests; CI blocks failures.

## Critical boundary

`log-viewer/` MUST NOT import `vscode` or anything from `lana/`. The two packages
communicate via message passing only.

## Workflow

- Conventional commits (`feat:`, `fix:`, `build:`, `chore:`, `ci:`, `docs:`, `style:`,
  `refactor:`, `perf:`, `test:`). Don't auto-commit.
- Branches: `feat-*` for features, `bug-*` for defects.
- Releases follow SemVer; update CHANGELOG; breaking changes need a migration guide.
- Never reference Anthropic or Claude in commit messages, PRs, etc.

## Rules manifest

Area-specific rules load on demand (Claude Code, scoped by path):

- `.claude/rules/log-viewer.md` — webview/UI: boundary, performance budgets, key paths.
- `.claude/rules/lana.md` — VS Code extension: UX, command paths.
