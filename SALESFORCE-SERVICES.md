# Salesforce Services — open items

Working notes for the `@salesforce/vscode-services` integration (#951 onwards). Upstream is
[forcedotcom/salesforcedx-vscode](https://github.com/forcedotcom/salesforcedx-vscode); the API
package pinned here is `@salesforce/vscode-services@67.15.0`, and the published extension on
Open VSX is `salesforce.salesforcedx-vscode-services`.

Each item says who owns it. Not every item is theirs.

---

## 1. `getConnection()` never settles when the org refuses the origin — theirs

**What happens.** `ConnectionService.getConnection()` issues no network request and never settles
when the org's CORS allowlist refuses the host origin. `ApexLogService.listLogs` then waits on it
for the life of the session. `activate()` still resolves, so a consumer sees a healthy extension.
The `TypeError: Failed to fetch` from `retrieveUserInfo` -> `initAuthOptions` -> `init` surfaces
only as an unhandled rejection.

**Measured** in a VS Code Web host against a scratch org, 2026-09-13:

| Call                                        | Result                    |
| ------------------------------------------- | ------------------------- |
| `ConfigService.getTargetOrg()`              | `undefined`, 34ms         |
| `ConnectionService.listAllAuthorizations()` | resolved, `Array`, 2542ms |
| `ConnectionService.getConnection()`         | never settled             |

**Our mitigation**, shipped in #1030: the Retrieve picker is cancellable, and its placeholder names
Escape. That hides the hang; it does not fix it.

**Ask them:**

1. Is there a supported way to ask whether Services can reach the org, before a call that can wait
   for good? `getTargetOrg()` is not it — see item 2.
2. Should `getConnection()` reject on an auth failure rather than wait?
3. Does `ManagedRuntime.runPromise(effect, { signal })` cancel the underlying request, or only the
   fiber? Escape aborts the fiber today, confirmed in a live host.

---

## 2. `getTargetOrg()` answers `undefined` while the org is authorised — theirs

`ConfigService.getTargetOrg()` reads local `sf` config. The Salesforce Web Console supplies the org
through settings instead, so the call answers `undefined` while auth is present and working.

We tried it as a precondition for Retrieve and reverted it (`ea5840ec`): the guard refused Retrieve
in the one environment it was written for.

**Ask them:** what is the supported way to read the active org in a web host? If `getTargetOrg()` is
desktop-only, that belongs in its doc comment.

**Measured 2026-11-01**, same org and same settings: over `http://localhost:3001` (the e2e config,
web security off) the Retrieve placeholder named the org user. Over `https://lana.localhost:3443`
(web security on) it named no org. The cause is not known.

---

## 3. Which folder is "the project" in a multi-root workspace? — theirs, then ours

`RetrieveLogFile.ts:72` writes retrieved logs to `workspace.workspaceFolders?.[0]`, so in a
multi-root workspace every log lands in the first folder whatever the user is working on.

That is a regression from `f987f566` (_fix(lana): align retrieved logs with services workspace_),
which replaced `QuickPickWorkspace.pickOrReturn(context)` with the fixed index. `QuickPickWorkspace`
still exists and still asks the user when there is more than one folder.

The commit message says the point was to align with the workspace Services itself uses. So Services
has a notion of "the workspace" that a consumer cannot see, and the fix has to start there.

### What the Services package needs

The API surface exposes no workspace or project concept at all — `@salesforce/vscode-services`'s
`out/index.d.ts` mentions neither. A consumer in a multi-root workspace therefore has no way to ask
which folder Services resolves paths against, and no way to tell it to use a different one. The
first folder is a guess that happens to match some of the time.

1. **Expose the active project.** Something a consumer can read — the workspace folder, or the
   `sfdx-project.json` root, that `FsService` and `ConfigService` resolve relative paths against.
   Without it, every consumer guesses, and each guesses differently.
2. **Let a consumer choose it.** A user can have several SFDX projects open in one window. Retrieve
   should write into the project the user is working in, which means either Services takes a project
   per call, or it exposes the active one and tracks it.
3. **Say what happens with no folder, or with several.** Today `getTargetOrg()` and the `FsService`
   calls give no clue whether they picked one, picked the first, or picked none.
4. **Document the relationship to `sf` config.** Per-project `.sf` config and a multi-root window
   interact, and which one wins is not stated anywhere a consumer can see.

**Ask them:** which of these exists already under another name, and which are genuinely missing?

**Then ours:** restore `QuickPickWorkspace.pickOrReturn(context)`, or use whatever they name. The
regression goes back to the commit author — see the repo rule on another contributor's regressions.

---

## 4. `validateNoCriticalErrors` is a no-op stub — theirs

In `@salesforce/playwright-vscode-ext@1.3.11` it is literally `async (...) => undefined`, with the
real body commented out and a TODO about filtering "ours" from "theirs". Calling it passes whatever
happened.

We do not call it. `logAnalysis.web.spec.ts` uses `setupConsoleMonitoring` + `filterErrors` and
asserts the result is empty, mirroring its own commented-out body.

**Ask them:** is it meant to ship, and should consumers rely on it? A stub that always passes is
worse than an absent helper.

---

## 5. The worker origin cannot load Services from the gallery — theirs, worked around

`@vscode/test-web` pushes `extensionIds` into `additionalBuiltinExtensions` as a gallery reference
(`workbench.js:135-139`), so the **browser** loads it, file by file, from `vscode-unpkg.net`. The
extension host worker runs on a `v--<hash>.localhost:3001` origin, and that host sends it no CORS
header, so activation fails with `TypeError: Failed to fetch`.

Measured 2026-09-15 against
`salesforce.vscode-unpkg.net/.../extension/dist/web/index.js`:

| Origin sent                       | `access-control-allow-origin` |
| --------------------------------- | ----------------------------- |
| `http://localhost:3001`           | `*`                           |
| `https://vscode.dev`              | `https://vscode.dev`          |
| `http://v--1a2b3c.localhost:3001` | **none**                      |

Note this is **not** the marketplace API, which answers `access-control-allow-origin: *` and
downloads fine. Plain `localhost` is allowed too — it is the worker subdomain that is refused.

**How it works today:** `createWebConfig` passes `--disable-web-security`, so Chromium ignores the
missing header and Services activates normally in the e2e (2691ms, measured). `pnpm serve:web` in a
real browser has always failed here, which is what #1029's local-copy preference fixes.

**Ask them:** should `vscode-unpkg.net` allow the `v--<hash>` worker origin a local web host runs
on? Without it, no one can test a dependent extension in `@vscode/test-web` without disabling web
security, and the supported route is written down nowhere.

---

## 6. An org needs three settings before a web host can reach it — ours to document, then theirs

Measured 2026-11-01 against a scratch org, with preflight `OPTIONS` requests and a live Retrieve.
Without all three, Services hangs as in item 1.

1. **A CORS allowlist entry for the extension host worker origin**, not only the page origin. On
   vscode.dev that is `https://*.vscode-cdn.net`. Setup > CORS, or `CorsWhitelistOrigin` metadata.
2. **Enable CORS for OAuth endpoints** (`SecuritySettings.sessionSettings.enableOauthCorsPolicy`).
   The allowlist does not cover `/services/oauth2/userinfo`. Without this setting that endpoint
   sends no `Access-Control-Allow-Origin` for any origin. Services calls it first
   (`retrieveUserInfo`), so this is the setting that unblocks item 1.
3. **HTTPS.** Salesforce accepts `http://` only for plain `localhost`, and a wildcard only before a
   second-level domain. So `http://v--<hash>.localhost:3001` cannot be allowed at all. A local test
   needs HTTPS on a host such as `lana.localhost`, with `https://*.lana.localhost:<port>` allowed.

With all three, the vscode.dev pre-release and a local HTTPS host both retrieved and opened a log
with web security on.

**Ours:** put the three settings in the user docs for VS Code for the Web.

**Ask them:** document these for every Services consumer, and make `getConnection()` reject with a
message that names them, not hang.

---

## Ours alone, tracked here because they touch the same code

- **`--disable-web-security` is load-bearing in the web e2e, and stays.** Measured 2026-09-15:
  VS Code Web loads a gallery web extension file by file from `vscode-unpkg.net`, and that host
  sends no `Access-Control-Allow-Origin` to the `v--<hash>.localhost` origin the extension host
  worker runs on — `*` for plain `localhost`, nothing for the worker subdomain. Remove the flag and
  Services never activates. #1043 puts it back after #1029 removed it and turned `main` red.
  The flag costs us CORS and CSP enforcement, but the harness origin is not the Web Console origin,
  so what it enforces would not predict production.
- **To drop the flag, serve Services same-origin.** An unpacked copy passed as `extensionPaths` is
  served by the test server itself, so it loads with web security on. Fetching a pinned VSIX at
  setup would give CI what it has today **and** let the flag come off. Not built.
- **`SfdxProjectReader.ts:47`** logs to `console.warn`, not the extension's own output channel.
- **`VSWorkspaceManager.ts:61`** discards the parse error in a `.catch`.
