---
name: ui-screenshots
description: Screenshot the log viewer in VS Code Web with Playwright. Use when asked for screenshots, to attach images to a PR, or to see a UI change in the real webview.
allowed-tools: Bash, Read, Write, Edit
---

# UI screenshots

The log viewer runs in VS Code Web under Playwright, opens the fixture log, and saves PNGs. No
desktop window is needed: the sandbox blocks `screencapture`, and Chrome DevTools cannot reach a
VS Code webview.

## Files

| Path                                              | What                                              |
| ------------------------------------------------- | ------------------------------------------------- |
| `lana/test/playwright/shots/*.shots.ts`           | Shot scripts. `callTree.shots.ts` is the example. |
| `lana/test/playwright/playwright.config.shots.ts` | Config: the web test setup, pointed at `shots/`.  |
| `lana/test/playwright/support/logAnalysis.ts`     | `openWorkbench`, `openLogAnalysis`: reuse them.   |
| `lana/test-results/shots/`                        | Output (gitignored). `LANA_SHOTS_DIR` moves it.   |

The log is `lana/test/playwright/fixtures/apex-log.log`. It is small: Time Order has one root.

## Steps

1. Change `callTree.shots.ts`, or add `<area>.shots.ts` beside it. Drive the UI to the state to show,
   then `shoot(locator, 'name')`.
2. Run it. It builds first, and it needs the network the first time, to fetch VS Code Web:

   ```bash
   pnpm shots:web
   ```

   Run outside the sandbox (`dangerouslyDisableSandbox: true`). Skip the build when it is fresh:
   `pnpm exec playwright test --config=lana/test/playwright/playwright.config.shots.ts --retries=0`.

3. Read every PNG. A blank or half-drawn frame is a failure, not a shot.
4. For a PR, reference each file in the body and attach it. `gh` uploads it and rewrites the link:

   ```bash
   gh pr edit <n> --body-file pr.md --attach './shots/name.png#Alt text'
   ```

   Paths in `--body-file` are relative to that file's folder.

## Driving the webview

- Get the frame: `webviewActiveFrame(page, hasContent('log-viewer'), { timeout: 60_000 })`.
- CSS locators reach into open shadow roots: `callTree.locator('tree-expand-button .more')`.
- Wait on what changed, not on a count you guessed: `await expect(rows).not.toHaveCount(before)`.
- Screenshot an element, not the page. The workbench chrome is noise.
- The theme is VS Code Web's default, Light.

## Skip

- Do not commit a throwaway shot script made for one PR. Delete it, or fold it into an existing
  `*.shots.ts` when the view is worth keeping.
- Do not add `*.shots.ts` to `test:e2e:web`. Shots are not tests.
