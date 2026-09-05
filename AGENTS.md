# Apex Log Analyzer

VS Code extension for analyzing Salesforce debug logs with interactive visualizations
(flame charts, call trees, SOQL/DML breakdowns).

> Canonical agent instructions for all tools. Claude Code loads this via `CLAUDE.md`.
> Area-specific rules live in `.claude/rules/` — see the Rules manifest below.

## Monorepo structure

- `lana/` — VS Code extension (TypeScript)
- `log-viewer/` — webview UI (TypeScript; lit / html / css)
- `apex-log-parser/` — shared log parser, no `vscode` and no DOM. Both `lana/` and
  `log-viewer/` import it by the bare `apex-log-parser` specifier: a `tsconfig` project
  reference plus a jest project, deliberately outside `pnpm-workspace.yaml`.
- `lana-docs/` — Docusaurus documentation
- `sample-app/` — sample Salesforce app with test logs

## Commands

Always use pnpm.

- `pnpm watch` — dev build with hot reload
- `pnpm build` — production build
- `pnpm test` — run tests (before committing)
- `pnpm lint` — eslint + `prettier --check` + `tsc -b`, run concurrently. The single
  pre-commit gate, so `typecheck` on top of it is wasted.
- `pnpm exec jest --selectProjects <apex-log-parser|log-viewer|lana>` — scoped tests,
  matching what CI runs per runner.
- `pnpm prettier-format` — auto-format

`DEVELOPING.md` covers the rest, including the `*:fast` rolldown variants and their caveats.

**Dev host** — launch with
`code-insiders --profile lana-dev $PWD/sample-app --extensionDevelopmentPath=$PWD/lana`, use the
CLI of the launched editor, `code-insiders` or `code`

**Compilers** — `typecheck` = native TS7 (`tsc`); `typecheck:tsc6` = classic 6.0 (`tsc6`).
Keep the `@typescript/typescript6` alias + `tsc6`: `typescript-eslint` and Docusaurus need
the TS ≤6.0 API (lands in TS 7.1). Don't remove until typescript-eslint supports TS7.

## Core principles

- **Type safety** — strict TypeScript, no `any` (use `unknown` + justification if unavoidable).
- **Modularity** — keep `lana/` and `log-viewer/` independent; cross-package contracts only.
- **Performance** — handle large logs (50MB+, 500k+ lines) without blocking the UI.
- **UX** — discoverable, accessible, actionable errors.
- **Testing** — features and bug fixes ship with tests; CI blocks failures.
- **Comments** — only the non-obvious: a why, a gotcha, an invariant. One terse line.
  Never restate code or narrate an edit — in doubt, no comment. JSDoc exported
  functions, not private helpers.

## How to work

### Think before coding

- Read the code beside yours first. Navigate with LSP, `ast-grep` or `rg`; read a whole file last,
  and only the range you need.
- Most "new" helpers already exist. Look in `log-viewer/src/core/utility/`,
  `log-viewer/src/components/`, `log-viewer/src/tabulator/` and `log-viewer/src/features/*/services/`.
- Where two modules share state, name one source of truth. Do not give each half the job.
- State a plan first for anything that crosses the `lana/` to `log-viewer/` boundary, or that
  changes the message contract.

### Simplicity first

- The smallest change that fully solves the goal. No abstraction until the second caller exists.
- CSS: no `!important`, and no 1px nudges. Fix the structure instead.
- A retired workaround is commented out with a note on when to re-add it, not left live behind a
  runtime check.

### Surgical changes

- Every changed line traces to the request. No drive-by reformatting or renaming, since
  `pnpm prettier-format` owns style. A bug seen in passing is mentioned, not fixed.
- Never hand-edit the vendored `tabulator_esm.mjs` beyond the sanctioned documented patches.
- The root `README.md`, `CHANGELOG.md` and `LICENSE.txt` are the sources of truth. The `lana/`
  copies are build output.

### Finish the job

- Restate the acceptance test before you start. Finish the whole scope, and say plainly what you
  left out and why.
- Prove it with the real command, not by reading the code. Report a failure with its own output,
  and never call something done unverified.
- In `log-viewer/`, the performance budgets in `.claude/rules/log-viewer.md` are part of the
  acceptance bar, measured on `sample-app/` logs.

## Critical boundary

`log-viewer/` MUST NOT import `vscode` or anything from `lana/`. The two packages
communicate via message passing only.

## Workflow

- Conventional commits (`feat:`, `fix:`, `build:`, `chore:`, `ci:`, `docs:`, `style:`,
  `refactor:`, `perf:`, `test:`). Don't auto-commit.
- Branches: `feat-*` for features, `bug-*` for defects.
- Releases follow SemVer; update CHANGELOG; breaking changes need a migration guide.
- CHANGELOG entries: one or two lines, no sub-bullets. Say what the user gets, not how it
  was built. Order each section by impact, most impactful first. A perf entry states its
  multiple or percentage. House style: `- <emoji> **Label**: <what the user gets> ([#issue])`.
- Never reference Anthropic or Claude in commit messages, PRs, etc.

## Rules manifest

Area-specific rules load on demand (Claude Code, scoped by path):

- `.claude/rules/log-viewer.md` — webview/UI: boundary, performance budgets, `--lana-*` appearance
  tokens, key paths.
- `.claude/rules/lana.md` — VS Code extension: UX, command paths.

Some modules also carry their own `AGENTS.md`. Read it before you change that module.
