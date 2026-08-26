# PR 951 and 952 review findings

## Scope

Review of upstream PRs:

- [#951 — `refactor(lana): use Salesforce Services`](https://github.com/certinia/debug-log-analyzer/pull/951)
- [#952 — `refactor(lana): use URI-safe file access`](https://github.com/certinia/debug-log-analyzer/pull/952)

Checked 2026-08-26. Review state at discovery time:

- PR 951: 14 open review threads; changes requested.
- PR 952: 5 open review threads; review required.
- No general PR comments or review-body findings; all findings are inline threads.

## Summary

Do not merge either PR unchanged.

Most lifecycle, caching, URI, menu, race, and display fixes belong in Log Analyzer and can start immediately. Correct multi-root org selection, complete log listing, reliable published types, and eliminating the consumer-owned Effect runtime require Salesforce Services changes.

## Dependency matrix

`Requires Services` means the complete Log Analyzer fix depends on a new or corrected Salesforce Services release.

| Log Analyzer change                                                | Requires Services | Reason                                                                                                      |
| ------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Lazy-load Services from Retrieve Log                               | No                | Log Analyzer controls activation and command flow.                                                          |
| Remove hard `extensionDependencies` and show install/update prompt | No                | Log Analyzer manifest and UX.                                                                               |
| Use `vscode.workspace.fs` for Log Analyzer files                   | No                | VS Code API; no Services dependency needed.                                                                 |
| Dynamically import the Services bridge                             | No                | Log Analyzer build and module boundary.                                                                     |
| Move `@salesforce/vscode-services` to `devDependencies`            | No                | Package contains compile-time declarations.                                                                 |
| Guard missing/outdated API by checking required exports            | No                | Structural guard can ship now.                                                                              |
| Use an explicit Services API version/capability contract           | Yes               | Services does not publish one.                                                                              |
| Restore cached-log reuse                                           | No                | Log Analyzer retrieval flow.                                                                                |
| Fix access-denied matching                                         | No                | Log Analyzer response validation.                                                                           |
| Keep cache path tied to the selected workspace                     | No                | Log Analyzer already owns workspace selection and the cache URI.                                            |
| Retrieve logs from the selected workspace's org                    | Yes               | `ApexLogService` resolves the Services-selected/default org.                                                |
| Use a workspace-aware Services debug-log directory                 | Yes               | `ProjectService.getDebugLogsFolder()` has no workspace argument.                                            |
| Replace the 25-log cap with full listing or Load More              | Yes               | `ApexLogService.listLogs()` needs pagination or an optional limit.                                          |
| Compile against trustworthy Services types                         | Yes               | Published declarations reference files absent from the npm package.                                         |
| Remove Log Analyzer's bundled Effect runtime                       | Yes               | Services must expose its runtime or Promise-returning wrappers.                                             |
| Remove URI-scheme allowlist                                        | No                | Log Analyzer detection policy.                                                                              |
| Restore command-palette visibility condition                       | No                | Log Analyzer manifest.                                                                                      |
| Suppress stale async language-detection results                    | No                | Log Analyzer request coordination.                                                                          |
| Read only the first 4 KB of large local files                      | No                | Desktop `file:` implementation can perform a bounded read.                                                  |
| Read a bounded prefix from virtual/web files                       | Partial           | Generic `workspace.fs.readFile()` returns the entire file; an efficient provider or Services API is needed. |
| Make `logPath` display-only and retain `logUri` for behavior       | No                | Log Analyzer/webview contract.                                                                              |
| Use the `WebWorker` TypeScript library                             | No                | Log Analyzer compiler configuration.                                                                        |
| Restore regression tests                                           | No                | Log Analyzer test suite.                                                                                    |

## Log Analyzer changes

### 1. Isolate Salesforce-only behavior

- Remove eager `initServices()` from extension activation.
- Initialize Services from Retrieve Log only.
- Cache the initialization promise to deduplicate concurrent calls.
- Remove the hard extension dependency.
- On missing or incompatible Services, offer an install/update action.
- Keep deactivation safe when Services was never initialized.
- Dynamically import the bridge so local analysis does not load Effect.

Local log analysis, parsing, decorations, navigation, and webview display must work without Salesforce extensions installed or active.

### 2. Own local file I/O

Use `vscode.workspace.fs` for Log Analyzer files:

- read and decode text;
- create parent directories and write encoded text;
- check existence with `stat`;
- save exported files;
- open and navigate using the original `Uri`.

Do not route local analysis through Salesforce `FsService`. This couples all file analysis to Services initialization and defeats lazy activation.

### 3. Restore retrieval behavior

- Build the cache URI from the workspace selected by `QuickPickWorkspace`.
- Check the cache before calling `getLogBody()`.
- Cache hit: open the local URI without downloading or writing.
- Cache miss: retrieve, validate, write, then open.
- Cache-write failure: report to the output channel but analyze the retrieved body.
- Match access-denied bodies with `/^access\s*denied$/i` after trimming.
- Test `AccessDenied`, `Access denied`, cache hit, cache miss, and write failure.

Do not replace the 25-log default with an arbitrary huge number. That hides truncation and remains incomplete.

### 4. Preserve multi-root consistency

Log Analyzer can immediately ensure the selected workspace controls the cache location. It cannot make Services query that workspace's org with the current API.

Until Services supports workspace/org targeting, choose one explicit interim behavior:

1. Block merge to preserve existing multi-root behavior; preferred.
2. Document and enforce first-workspace-only retrieval; behavior regression.

Never query workspace B's org and cache the result under workspace A.

### 5. Guard the Services boundary

- Treat extension exports as `unknown` until validated.
- Check `services`, `prebuiltServicesDependencies`, `ApexLogService.listLogs`, and `ApexLogService.getLogBody` before use.
- Show an actionable incompatible-version message.
- Move the npm declaration package to `devDependencies`.
- After corrected types are published, pin or constrain to the first compatible release.

Structural checks are an interim compatibility mechanism, not a substitute for a Services-owned API version.

### 6. Fix URI and language detection

- Remove the fixed `file`/`vscode-vfs`/`memfs` scheme allowlist.
- Detect active documents by content and extension.
- Let registered filesystem providers determine whether fallback reads succeed.
- Restore `resourceLangId == apexlog || lana.isApexLog` on the command-palette contribution.
- Increment a generation counter for every context update.
- Apply an async result only when its generation and URI are still current.
- Add a deferred-promise test for switching from a slow log to a fast non-log file.

Debouncing alone does not prevent stale results.

### 7. Preserve large-file performance

The proposed `workspace.fs.readFile(uri)` followed by `bytes.subarray(0, 4096)` avoids decoding the full file but still reads the full file.

Recommended behavior:

- Desktop `file:` URI: true 4 KB read.
- Virtual/web URI: provider read with 4 KB decode; avoid repeated reads through result caching where safe.
- Future: use a bounded Services/provider read when available.

Large-file tests should verify stale-result suppression and bounded local reads, not only content matching.

### 8. Keep URI and display path separate

- `logUri`: authoritative identity for fetch, open, navigation, and webview resource conversion.
- `logPath`: display text only; prefer `workspace.asRelativePath(logUri, true)`.
- Ignore webview-supplied paths for opening files; use the captured trusted URI.
- Test file and non-file URIs.

### 9. Compiler configuration

- Remove Node types after Node-only imports leave the shared source.
- Replace `DOM` with `WebWorker` for the web extension host.
- Keep strict TypeScript settings.

The current source typechecks with `ES2022,WebWorker`.

## Salesforce Services changes

### 1. Workspace-scoped services

Current `WorkspaceService`, `ConfigService`, and `ProjectService` resolve `workspaceFolders[0]`. Add explicit workspace inputs where behavior can vary by root.

Required APIs:

- workspace-aware config/default-org resolution;
- `ProjectService.getDebugLogsFolder(workspaceUri)`;
- Apex-log operations targeting a workspace, username, org, or connection.

`ApexLogService.listLogs()` and `getLogBody()` must use the same explicit target for one retrieval flow.

### 2. Complete log listing

Current v67.12 behavior defaults `listLogs()` to 25 records and always emits `LIMIT`.

Provide one of:

- optional limit with no `LIMIT` when omitted;
- paged results with continuation;
- cursor/load-more API.

Pagination is preferred for predictable memory and UI behavior.

### 3. Correct published declarations

The installed `@salesforce/vscode-services` 67.13.3 `out/index.d.ts` exports from `../../salesforcedx-vscode-services/out/src/index`, which is absent from the published package. `skipLibCheck` masks the break and weakens the consumer contract.

Publish self-contained declarations and add a package smoke test that installs the tarball in an isolated TypeScript consumer.

### 4. Version and capability contract

Export an API version or capability object. Consumers need to distinguish:

- extension missing;
- extension too old;
- required service absent;
- compatible API.

VS Code extension dependencies do not enforce the npm declaration version or a minimum runtime API version.

### 5. Shared runtime or Promise boundary

Services already owns the built service context and an internal runtime. Export either:

- the prebuilt runtime; or
- stable Promise-returning wrappers for public operations.

This avoids every consumer bundling Effect and reconstructing a `ManagedRuntime` over the exported context.

### 6. Optional bounded-read API

For large virtual/web resources, consider `FsService.readFilePrefix(uri, maxBytes)` or an equivalent provider capability. This is not required for Log Analyzer's local-file fix, but it is required for efficient bounded detection across all supported schemes.

## Review-thread disposition

### PR 951

| Review topic                                | Disposition                                                             | Owner                       |
| ------------------------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| Launch configuration isolation              | Resolve; no code change                                                 | None                        |
| Hard-coded `.sfdx/tools/debug/logs`         | Keep selected-workspace construction until Services accepts a workspace | Services, then Log Analyzer |
| Types package in runtime dependencies       | Move to `devDependencies`                                               | Log Analyzer                |
| Runtime/declaration version drift           | Structural guard now; version contract later                            | Both                        |
| Broken declaration package                  | Fix published package                                                   | Services                    |
| 25-log regression                           | Add pagination/optional limit, then consume it                          | Services, then Log Analyzer |
| Access-denied regex                         | Fix regex and tests                                                     | Log Analyzer                |
| Cached log always downloaded                | Restore existence check                                                 | Log Analyzer                |
| Multi-root org mismatch                     | Add workspace/org target API                                            | Services, then Log Analyzer |
| Eager activation failure                    | Lazy initialization and install/update UX                               | Log Analyzer                |
| Use `workspace.fs`                          | Accept for Log Analyzer-owned files                                     | Log Analyzer                |
| Consumer-owned Effect runtime/bundle growth | Export runtime or Promise wrappers                                      | Services                    |
| Temporary Node types                        | Remove in PR 952 when Node imports leave                                | Log Analyzer                |
| `DOM` versus `WebWorker`                    | Use `WebWorker`                                                         | Log Analyzer                |

### PR 952

| Review topic              | Disposition                                                              | Owner                                    |
| ------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| URI-scheme checks         | Remove allowlist; detect by content                                      | Log Analyzer                             |
| Command always visible    | Restore `when` clause                                                    | Log Analyzer                             |
| Full large-file read      | True bounded local read; virtual fallback; Services enhancement optional | Log Analyzer; Services for full coverage |
| Async context-key race    | Generation/URI guard and regression test                                 | Log Analyzer                             |
| URI shown as display path | Separate display path from authoritative URI                             | Log Analyzer                             |

## Delivery order

Parallel tracks:

1. Log Analyzer-only fixes: lifecycle, file I/O, cache, regex, URI detection, race, menu, display, compiler config, tests.
2. Services fixes: declarations, workspace/org targeting, pagination, capability version, shared runtime.

Integration after a Services release:

1. Update the Log Analyzer declaration dependency.
2. Set the minimum API capability/version.
3. Pass the selected workspace/org through every Apex-log operation.
4. Add Load More or complete listing.
5. Replace the local Effect runtime with the exported runtime/Promise boundary.
6. Run typecheck, lint, unit tests, production build, desktop extension tests, and web extension tests.

## Acceptance criteria

- Local log analysis works without Salesforce extensions active.
- Retrieve Log offers actionable install/update errors.
- Selected workspace controls both org and cache location.
- More than 25 logs are reachable without an arbitrary cap.
- Cached logs are not downloaded again.
- 100 MB+ local logs are not fully read for detection.
- Switching tabs cannot publish stale `lana.isApexLog` state.
- URI-backed logs retain correct open/navigation behavior and readable titles.
- Published Services declarations typecheck in an isolated consumer.
- Log Analyzer does not bundle a second Effect runtime after the Services runtime API lands.

## Source references

- [Salesforce Services v67.12 `ApexLogService`](https://github.com/forcedotcom/salesforcedx-vscode/blob/v67.12.0/packages/salesforcedx-vscode-services/src/core/apexLogService.ts)
- [Salesforce Services v67.12 `ProjectService`](https://github.com/forcedotcom/salesforcedx-vscode/blob/v67.12.0/packages/salesforcedx-vscode-services/src/core/projectService.ts)
- [Salesforce Services repository](https://github.com/forcedotcom/salesforcedx-vscode)
