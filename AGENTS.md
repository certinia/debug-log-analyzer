# Apex Log Analyzer

VS Code extension for analyzing Salesforce debug logs with interactive visualizations
(flame charts, call trees, SOQL/DML breakdowns).

> Canonical agent instructions for all tools. Claude Code loads this via `CLAUDE.md`.
> Area-specific rules live in `.claude/rules/` — see the Rules manifest below.

## Monorepo structure

- `lana/` — VS Code extension (TypeScript)
- `log-viewer/` — webview UI (TypeScript; lit / html / css)
- `apex-log-parser/` — shared log parser, no `vscode` or DOM deps. Both `lana/` and `log-viewer/`
  import it by the bare `apex-log-parser` specifier: a `tsconfig` project reference plus a jest
  project, deliberately outside `pnpm-workspace.yaml`.
- `lana-docs/` — Docusaurus documentation
- `sample-app/` — sample Salesforce app with test logs

## Commands

Always use pnpm.

- `pnpm watch` — dev build with hot reload
- `pnpm build` — production build
- `pnpm test` — run tests (before committing)
- `pnpm lint` — eslint + `prettier --check` + `tsc -b`, run concurrently. The single pre-commit
  gate; no need to run `typecheck` as well.
- `pnpm exec jest --selectProjects <apex-log-parser|log-viewer|lana>` — scoped tests, matching what
  CI runs per runner.
- `pnpm prettier-format` — auto-format

`DEVELOPING.md` covers the rest, including the `*:fast` rolldown variants and their caveats.

**Compilers** — `typecheck` = native TS7 (`tsc`); `typecheck:tsc6` = classic 6.0 (`tsc6`).
Keep the `@typescript/typescript6` alias + `tsc6`: `typescript-eslint` and Docusaurus need
the TS ≤6.0 API (lands in TS 7.1). Don't remove until typescript-eslint supports TS7.

## Core principles

- **Type safety** — strict TypeScript, no `any` (use `unknown` + justification if unavoidable).
- **Modularity** — keep `lana/` and `log-viewer/` independent; cross-package contracts only.
- **Performance** — handle large logs (50MB+, 500k+ lines) without blocking the UI.
- **UX** — discoverable, accessible, actionable errors.
- **Testing** — features and bug fixes ship with tests; CI blocks failures.

## How to work

### Think Before Coding

- Read the adjacent code before writing new code. Navigate with LSP / `ast-grep` / `rg`; read whole
  files last, and only the range needed.
- Most "new" helpers already exist. Check `log-viewer/src/core/utility/`,
  `log-viewer/src/components/`, `log-viewer/src/tabulator/`, `log-viewer/src/features/*/services/`.
- When two modules share state, name one source of truth; don't give each half the job.
- State a plan first for anything crossing the `lana/` ↔ `log-viewer/` boundary or changing the
  message contract.

### Simplicity First

- The smallest change that fully solves the goal. No abstraction until the second caller exists.
- CSS: no `!important`, no 1px nudges — fix the structure.
- Retired workarounds get commented out with a re-add note, not left live behind a runtime gate.

### Surgical Changes

- Every changed line traces to the request. No drive-by reformatting or renaming —
  `pnpm prettier-format` owns style. A bug spotted in passing gets mentioned, not fixed.
- Never hand-edit the vendored `tabulator_esm.mjs` beyond the sanctioned documented patches.
- Root `README.md` / `CHANGELOG.md` / `LICENSE.txt` are the sources of truth; the `lana/` copies are
  build output.
- One concern per commit. Show the message and file list, then wait for approval.

### Goal-Driven Execution

- Restate the acceptance test before starting. Finish the whole scope, and say plainly what was left
  out and why.
- Verify with the real command, not by inspection. Report failures with the actual output; never
  claim "works" unverified.
- For `log-viewer/` work the performance budgets in `.claude/rules/log-viewer.md` are part of the
  acceptance bar, benchmarked against `sample-app/` logs.

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

- `.claude/rules/log-viewer.md` — webview/UI: boundary, performance budgets, `--lana-*` appearance
  tokens, key paths.
- `.claude/rules/lana.md` — VS Code extension: UX, command paths.

Some modules also carry a nested `AGENTS.md`. Read it before changing that module.
