# 🚀 Releasing the Apex Log Analyzer Extension

This guide explains how maintainers release stable and pre-release versions.

> ℹ️ Contributors don't need this — packaging and publishing are handled in GitHub by maintainers.
> For local dev and packaging, see [DEVELOPING.md](./DEVELOPING.md).

## 📚 Table of Contents

1. [Versioning Convention](#-versioning-convention)
2. [Pre-Release Flow (Automated)](#-pre-release-flow-automated)
3. [Stable Release Flow (Manual)](#-stable-release-flow-manual)
4. [Marketplace README Limitation](#-marketplace-readme-limitation)
5. [Marking Pre-Release-Only Features](#-marking-pre-release-only-features)

## 🔢 Versioning Convention

We follow VS Code's recommended [odd/even pre-release scheme](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):

> Why this convention: Marketplace publishing supports `major.minor.patch` only (no SemVer pre-release identifiers), so pre-release and stable builds must use different numeric versions. We use odd/even minors for that split. See [microsoft/vsmarketplace#50](https://github.com/microsoft/vsmarketplace/issues/50).

- **Stable** — `major.EVEN.patch` (e.g. `1.18.1`). The **minor is always even**.
- **Pre-release** — `major.ODD.yyyymmdd` (e.g. `1.19.20260529`). The **minor is the next odd
  number** and the patch is the build date.

Keep the committed `lana/package.json` version on the current stable (even minor).

## 🤖 Pre-Release Flow (Automated)

Pre-releases are fully automated by [`.github/workflows/cd-prerelease.yml`](./.github/workflows/cd-prerelease.yml). No manual action is required.

- **Trigger** — weekly cron (Tuesdays 04:15 UTC) plus manual `workflow_dispatch`.
- **`check` job** — compares `HEAD` against the floating `pre` tag and the latest stable tag. If `HEAD` already matches either (no new commits since the last pre-release or stable), it exits early and nothing is published.
- **`publish` job** — when there are new commits it bumps a CI-only pre-release version, packages and publishes with `--pre-release`, then moves the floating `pre` tag to `HEAD`.

## 📦 Stable Release Flow (Manual)

A stable release is cut by hand. Do these steps in order:

1. **Choose the release branch.**
   - Use `main` for the current stable line.
   - Create/use a release branch only when shipping a patch for an older version line (for example, `main` already contains work for the next major/minor).

1. **Update the changelog + readme.**
   - Rename `[Unreleased]` in the root [`CHANGELOG.md`](./CHANGELOG.md) to `## [X.Y.Z] YYYY-MM-DD` .
   - Only edit the **root** `CHANGELOG.md`
   - For features that ship in this release, remove their `🧪` badges in the root `README.md` (see [Marking Pre-Release-Only Features](#-marking-pre-release-only-features)).

1. **Bump the version.** Set `version` in [`lana/package.json`](./lana/package.json) to the new stable version. Use the **next even minor** (`1.18.x` → `1.20.0`) for a feature release, or a patch bump (`1.18.1` → `1.18.2`) for a fix-only release. Commit these changes to the selected release branch.
1. **Create a GitHub Release.** Tag the release with a name that **exactly equals** the
   `lana/package.json` version (e.g. `1.20.0`).

   > ⚠️ **Gotcha:** [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) packages
   > `lana-<package.json version>.vsix` but publishes `lana-${tag_name}.vsix`. If the tag name and
   > the `package.json` version don't match, the publish step fails because the `.vsix` filename
   > won't exist. **No `v` prefix** — use `1.20.0`, not `v1.20.0`.

1. **Publish runs automatically.** `publish.yml` fires on the release `published` event, packages the
   extension, and publishes the stable build to the VS Code Marketplace and Open VSX.

## 🌐 Marketplace README Limitation

VS Code Marketplace always shows the README and `CHANGELOG` from the highest published version. There is no separate stable/pre-release README. Because pre-releases usually have a higher odd minor, the public Marketplace page may show pre-release docs. See [microsoft/vscode#163477](https://github.com/microsoft/vscode/issues/163477).

Practical consequences:

- Keep the README channel-neutral.
- Treat root `README.md`, `CHANGELOG.md`, and `LICENSE.txt` as the source of truth. Do not hand-edit the generated `lana/` copies.

## 🧪 Marking Pre-Release-Only Features

Because the public README can show pre-release content to stable users (see above), mark
pre-release-only features clearly so stable users aren't misled about what they can use today.
**Add the marker in the same PR that introduces the feature** (the PR template has a checklist
reminder).

### README — inline `🧪` badge

The README uses a compact inline badge so deeply nested feature lists stay readable. The legend is
defined once near the top:

```md
> 🧪 **Pre-Release only** — available in the [Pre-Release Version](#-try-the-pre-release-version); not yet in the stable release.
```

Then append `🧪` at the smallest accurate scope:

- **Whole feature/section** is pre-release → on the section heading (e.g. `## 📄 Raw Log Navigation 🧪`).
- **A single bullet** is pre-release → at the end of that bullet.
- **Only part of a bullet** → right after the specific phrase (e.g. `… or Caller Namespace 🧪, or Query`).

When a feature graduates to stable, **removing its `🧪` badge is part of the stable release
checklist** (step 1 above).
