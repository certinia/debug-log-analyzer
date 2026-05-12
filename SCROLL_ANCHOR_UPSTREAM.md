# ScrollAnchor — upstream Tabulator PR brief

This document is written for an agent preparing an upstream PR to [Tabulator](https://github.com/olifolkerd/tabulator) that adds **pixel-accurate scroll anchoring** as a first-class feature, based on a working downstream module. It maps the existing implementation onto upstream source, names the private APIs that need public equivalents, and separates the symptom-side workarounds from the cause-side fixes that belong in the core.

The reference implementation is a custom Tabulator module that has been shipping in production. The agent does not need to read it to follow this brief — every load-bearing piece of it is described here. References to "the reference module" point at `ScrollAnchor.ts` in the originating repo if you want to cross-check.

**Reference versions**: all `tabulator_esm.mjs` line numbers in this document are pinned to **`tabulator-tables@6.4.0`**. If you're on a different version, grep for the surrounding identifier (e.g. `rerenderRows`, `_virtualRenderFill`) — line numbers drift but the call sites have been stable across recent 6.x releases.

## 1. Goal & user-visible behaviour

The default Tabulator behaviour after a re-render (sort, filter, tree expand/collapse, data update) is to leave `scrollTop` wherever the renderer happened to land. For virtual-scrolled tables this often means the user's row of interest jumps off-screen, or the viewport flashes through an intermediate position before settling. The proposed feature keeps a chosen anchor row at the same Y pixel inside the table holder across every re-render — synchronously, with no perceptible flash.

Behaviours the feature MUST provide:

1. **Pixel-accurate anchor**. The row that was at the visual middle of the holder before a re-render is at the same Y pixel after.
2. **Boundary snap**. When the user was at the very top or very bottom of the scroll range pre-render, restore to that edge instead of pixel-anchoring — anchoring on a middle row at the edge feels broken because it pushes the user away from the boundary.
3. **Single tree-toggle is non-disruptive**. Expanding or collapsing one row should not move the user's scroll position at all.
4. **Bulk tree-toggle still recenters**. Expand-all / collapse-all (multiple synchronous toggles) should anchor the same way as sort / filter, so the user's row stays in view rather than scrolling far off-screen as the row count changes by orders of magnitude.
5. **Filter does not leave a blank strip**. Tabulator's `rerenderRows` after a filter currently inflates `paddingTop` on `.tabulator-table`; the anchored experience must not show this.
6. **Anchor row fallback**. When the captured anchor row no longer exists in the post-render display set (filtered out, collapsed under a parent), the feature falls back to the nearest still-displayed row by row identity and keeps the user near where they were.

## 2. Proposed public surface

- **Module name**: `scrollAnchor` (matches downstream).
- **Table option**: `scrollAnchor: true` toggles the feature on. Default `false` for backwards compatibility.
- **No per-row API** is needed. The anchor is computed automatically from the visible rows in the holder.
- **Optional sub-option**: `scrollAnchor: { boundaryThresholdPx: number }` to override the edge-detection threshold (default `10`). Only add this if a non-default is requested during review — the constant works for every downstream case so far.

## 3. Algorithm

Pseudocode, free of Tabulator-specific identifiers, so the contract is reviewable on its own:

```text
state:
  anchorRow:        Row | null
  anchorOffsetFromHolderTop:   number    # row top - holder.scrollTop, captured pre-render
  wasAtTop:         bool
  wasAtBottom:      bool
  skipNextRender:   bool
  toggleSeenInBurst: bool

state (continued):
  anchorDisplayIndex: int    # row's index in displayRows pre-render (filter fallback)

on capture-event (sort starting, render starting):
  if anchorRow is set: return                        # idempotent within one op
  wasAtTop    = holder.scrollTop <= threshold
  wasAtBottom = (holder.scrollHeight - holder.clientHeight) - holder.scrollTop <= threshold
  # When content fits entirely, scrollTop is forced to 0 → wasAtTop is true and
  # the restore snaps to top. This matches CSS overflow-anchor (which excludes
  # non-scrollable containers).
  anchorRow          = findMiddleVisibleRow(holder)
  anchorOffsetFromHolderTop     = anchorRow.element.offsetTop - holder.scrollTop
  anchorDisplayIndex = displayRows.indexOf(anchorRow)

on render-complete:
  if skipNextRender:
     skipNextRender = false; clear-anchor; return
  if not anchorRow: return
  if wasAtTop:       holder.scrollTop = 0
  elif wasAtBottom:  holder.scrollTop = holder.scrollHeight - holder.clientHeight
  else:
     row = resolveAnchorRow(anchorRow)               # fallback if filtered/collapsed
     if row.element is detached:                     # outside post-render vDom window
        rendererRefillCenteredOn(row)                # see §5
     holder.scrollTop = row.element.offsetTop - anchorOffsetFromHolderTop
  clear-anchor
  toggleSeenInBurst = false

on tree-toggle (expand or collapse):
  if not toggleSeenInBurst:                          # first in this synchronous burst
     toggleSeenInBurst = true; skipNextRender = true # treat as single → don't move
  else:                                              # bulk burst → second toggle clears skip
     skipNextRender = false
  clear-anchor                                       # let the next capture run fresh

findMiddleVisibleRow(holder):
   target = holder.clientHeight / 2
   walk visible rows top-to-bottom, summing intersected heights.
   Partial visibility at the edges is clipped: subtract any portion above
   the holder top (topDiff) and below the holder bottom (bottomDiff) so
   the running sum reflects only the on-screen pixels of each row.
   Return the first row whose cumulative intersected height reaches target,
   or null if cumulative height never reaches it (in which case content fits
   the holder; the boundary snap takes precedence anyway).

resolveAnchorRow(row):
   if row is in current displayRows: return row
   # Collapse leg: walk up tree parents to nearest displayed ancestor.
   p = row.getTreeParent()
   while p:
      if p in displayRows: return p
      p = p.getTreeParent()
   # Filter leg: same position in the new display rows (clamped).
   if anchorDisplayIndex >= 0 and displayRows.length > 0:
      idx = min(anchorDisplayIndex, displayRows.length - 1)
      return displayRows[idx]
   return null
```

Restore is **fully synchronous in the `renderComplete` handler** — no `await`, no `setTimeout`, no `requestAnimationFrame`. The browser paints the corrected `scrollTop` directly from the post-render frame; any deferral re-introduces a one-frame flash.

## 4. Required Tabulator hooks

Each entry: hook used, why it's needed, where it fires upstream.

| Hook                                          | Why                                                                                                                                                                                                                                                                                                                   | Upstream emit site (sketch)                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `dataSorting`                                 | **Primary capture for sorts.** Sort calls `rowManager.scrollVertical(0)` (or equivalent) before `renderStarted` fires, so by the time `renderStarted` runs, `scrollTop` has been zeroed and `findMiddleVisibleRow` would pick the wrong row. We capture _pre-sort_, while `scrollTop` still reflects the user's view. | Sort module before it triggers `rowManager.refreshActiveData("sort")`. |
| `renderStarted`                               | **Primary capture for filter / tree toggle / data updates.** `scrollTop` is still valid here for these operations. The handler is a no-op when the anchor was already captured by `dataSorting` (`if (anchorRow) return`).                                                                                            | `RowManager` before each `_virtualRenderFill`.                         |
| `renderComplete`                              | **Restore site.** Called after the new vDom window is in the DOM. The handler reads `offsetTop` of the post-render anchor row element and writes `scrollTop`.                                                                                                                                                         | `RowManager` after `_virtualRenderFill` finishes.                      |
| `dataTreeRowExpanded`, `dataTreeRowCollapsed` | **Tree-toggle burst detection.** Used to set `skipNextRender` for single toggles and clear it when a second toggle arrives synchronously (bulk).                                                                                                                                                                      | `DataTree` module on each toggle.                                      |
| `dataFiltered`                                | **Filter padding fix.** Wraps the symptom-side mitigation described in §6. Schedules the check on `requestAnimationFrame` so it runs after the post-filter render.                                                                                                                                                    | `Filter` module after applying filter.                                 |

If the upstream PR adds a dedicated `RowManager` callback that runs _before_ sort zeros `scrollTop` (e.g. `dataSortInitiated` or `beforeSort`), it can replace `dataSorting` as the capture site cleanly.

**Option-gated subscription**: every subscription above must be installed inside `initialize()` _only when_ `options.scrollAnchor` is truthy. When the option is off (the default), the module attaches no listeners and contributes zero per-render overhead. The reference implementation does exactly this — see `ScrollAnchor.ts:45-83`. Keeping the gate tight is what makes the feature genuinely additive and free for users who don't opt in.

## 5. Private APIs touched & proposed public equivalents

The downstream module accesses three private APIs via `@ts-expect-error` casts. Each must be replaced with a public equivalent before upstream merge.

### 5.1 `row._getSelf()` — internal Row reference from a RowComponent

- **Used at**: `_isRowActive`, `_anchorPixelAccurate` in the reference module — both compare a `RowComponent` against the entries returned by `rowManager.getDisplayRows()` or `renderer.rows()`, which return _internal_ `Row` instances. `RowComponent` and `Row` are not `===` equal, so the comparison requires `_getSelf()`.
- **Reason**: identity comparison in O(1) array lookup. No data is mutated.
- **Public equivalent (proposed)**: add `RowComponent.getInternal(): Row` (or an internal-only utility on `RowManager`: `rowManager.includes(component): boolean`). The simplest public surface is the latter — it removes the need to expose `Row` itself and matches what every caller actually wants ("is this component still in the display set?").
- **Same leak via `rowManager.getDisplayRows()`**: `getDisplayRows()` returns internal `Row` instances, not `RowComponent`s. The reference module uses it at `ScrollAnchor.ts:108` (to capture `anchorDisplayIndex`) and `:186` (to drive the fallback) by comparing against `component._getSelf()`. The same proposed public API resolves both call sites — `rowManager.includes(component)` covers the membership test, and a sibling `rowManager.getDisplayComponents(): RowComponent[]` would let downstream avoid `_getSelf()` entirely.

### 5.2 `renderer._virtualRenderFill(index, force)` — refill the vDom centered on a specific row index

- **Used at**: `_anchorPixelAccurate` when the anchor row's element is detached (`!rowEl.isConnected`) because the post-render vDom window does not include it. Without refilling first, `rowEl.offsetTop` is stale and the resulting `scrollTop` write lands on the wrong row.
- **Reason**: bring the anchor row's DOM element back online before reading its post-layout offset. The same hook is called by Tabulator's public `scrollToRow` internally, but `scrollToRow` is async and tries to scroll — we want to refill _without_ scrolling because we are about to set `scrollTop` ourselves.
- **Public equivalent (proposed)**: `rowManager.renderer.ensureRendered(rowIndex: number): void` — synchronously refills the vDom around `rowIndex` with no scroll side-effect. Implementation can be a one-liner that calls the existing `_virtualRenderFill(index, true)`.

### 5.3 `renderer.vDomTopPad` — internal padding state

- **Used at**: `_resetStaleTopPadding` after a filter, to keep Tabulator's internal model in sync with the DOM after we zero `.tabulator-table`'s inline `paddingTop`.
- **Reason**: if we only reset the DOM style, the next render reads the stale `vDomTopPad` and re-inflates the padding.
- **Public equivalent**: not needed if the **upstream filter fix in §6 lands** — the bug never occurs, the symptom-side workaround disappears, and `vDomTopPad` stays internal. If the filter fix is deferred, expose `rowManager.renderer.resetTopPadding(): void` as a transitional API.

The upstream patch should reference `tabulator_esm.mjs` line ~25265 (v6.4.0) (the `rerenderRows` site identified in the downstream comment) when locating the bug.

### 5.4 `renderer.rows()` — array of internal Row instances in the current vDom window

- **Used at**: `_anchorPixelAccurate` in the reference module (`ScrollAnchor.ts:161`). We need the index of the anchor's internal Row inside the renderer's view so we can pass it to `_virtualRenderFill`.
- **Reason**: lookup-only. `_virtualRenderFill(index, force)` takes a numeric index, not a row reference.
- **Public equivalent (proposed)**: roll this into a higher-level API so callers never need the array directly: `renderer.ensureRendered(row: RowComponent): void`. The renderer does the index lookup internally and refills the vDom around it with no scroll side-effect. Subsumes both §5.2 and §5.4 — callers don't touch indices or internal arrays at all.

## 6. Filter padding fix

### Bug

After a filter, `rerenderRows()` (around `tabulator_esm.mjs:25265`) iterates the **pre-filter** `vDomTop..vDomBottom` indices against the **post-filter** rows array. When the pre-filter window points past the end of the post-filter list, the resulting `topOffset` is large; that flows into `_virtualRenderFill` and inflates `vDomTopPad`, which is written onto `.tabulator-table` as inline `paddingTop`. The user sees a blank strip across the top of the holder until the next interaction.

### Symptom-side detection (downstream module)

Used as a verification heuristic, not the upstream fix:

```text
if paddingTop > 0 and holder.scrollTop < paddingTop:
   # there is more empty space above the rendered window than the user has scrolled past
   .tabulator-table.style.paddingTop = '0px'
   renderer.vDomTopPad = 0
```

This runs on `requestAnimationFrame` after `dataFiltered` so the DOM has settled. It is reliable for detection but is a band-aid — it papers over the bad state instead of preventing it.

The reference module stores the pending rAF handle and cancels it before scheduling a new one (`ScrollAnchor.ts:65-71`). Rapid sequential `dataFiltered` events (e.g. typing in a header filter) otherwise queue redundant checks and can race against each other. Once the cause-side fix below lands, the rAF and its cancellation both disappear.

### Cause-side fix (upstream PR)

Inside `rerenderRows`, before the iteration that produces `topOffset`:

```text
# Clamp the pre-filter window to the post-filter row count.
postCount = rows.length
if vDomTop > postCount:    vDomTop    = max(0, postCount - 1)
if vDomBottom > postCount: vDomBottom = postCount
```

…or, equivalently, recompute `vDomTop` from the current `scrollTop` and average row height when the pre-filter window is invalid against the new row set. Either prevents `topOffset` from running away.

The PR should include a regression test that filters a long list down to a short list and asserts `parseFloat(table.element.querySelector('.tabulator-table').style.paddingTop)` is `0` after the filter completes.

## 7. Edge cases & rationale

- **Sort vs. other re-renders.** Two capture sites (`dataSorting` + `renderStarted`) exist because sort is the only operation that resets `scrollTop` before render starts. Removing the duplication requires a new pre-sort hook upstream (see §4 note).
- **Single vs bulk tree toggle.** Synchronous-burst detection (a flag set on the first toggle and cleared on the second within the same JS turn) lets the module distinguish `userClickedOneCaret` from `userPressedExpandAll` without a timer. A timer would be wrong because expand-all and a deliberate two-row click are indistinguishable on the wall clock; the JS event-loop turn is the only reliable separator.
- **Boundary snap.** Pixel-anchoring at the boundary feels broken: the user was at the bottom and now they're floating in the middle of an empty stretch because the anchor row moved. Snap-to-edge restores the natural feel. Threshold is in pixels (default 10) to tolerate sub-pixel scrollbar values. The `wasAtBottom` restore clamps with `Math.max(0, scrollHeight - clientHeight)` (`ScrollAnchor.ts:126`) so a holder that briefly has `scrollHeight < clientHeight` (post-filter shrinkage) writes `0` rather than a negative scrollTop.
- **Fits-in-viewport.** When the visible content is shorter than the holder (e.g. an aggressive filter leaves three rows in a 600px holder), the browser forces `scrollTop = 0` — there is nothing to scroll. Both boundary checks evaluate true; `wasAtTop` is checked first in the restore and wins → snap to top. This matches CSS `overflow-anchor`, which excludes non-scrollable containers from anchoring (and is the convention followed by virtual-list libraries like Virtuoso and TanStack Virtual). User-visible behaviour: "filter to a tiny list, then clear the filter → user lands at the top of the unfiltered list." If a future requirement is to return the user to their _pre-filter_ row across a filter→clear round-trip, that requires capturing the anchor before the filter changes the active set (subscribe to `dataFiltering`) — out of scope for this module's current behaviour.
- **Anchor-row fallback.** When the captured row is no longer in the display set, the feature uses a two-leg, data-agnostic fallback (already implemented in the reference module — no upstream-only work):
  - **Collapse case** (anchor row is hidden under a now-collapsed ancestor) → walk up `RowComponent.getTreeParent()` to the nearest displayed ancestor. This matches the natural feel of "I see where my row went, it's under this collapsed parent." Public Tabulator API.
  - **Filter case** (anchor row removed entirely) → capture the anchor row's index in `rowManager.getDisplayRows()` at snapshot time; on restore, use the row at that index in the post-render display set, clamped to `displayRows.length - 1`. Replaces "nearest by timestamp" (which only made sense in time-ordered tables) with "same position in the list" (natural in any sort order).
  - If neither leg yields a row (no displayed ancestor and empty post-render display set), return `null` and the restore is a no-op for that frame.

## 8. What to drop when going upstream

- **All `@ts-expect-error` casts**. Replaced by the public APIs in §5.
- **References to the originating repo** (`tabulator-virtual-scroll-fixes.md`, "Fix 7"). The upstream module has no dependency outside Tabulator.
- **Symptom-side filter padding mitigation** (`_resetStaleTopPadding`, `dataFiltered` rAF). Becomes unnecessary once the cause-side fix in §6 lands; if both ship, drop the workaround.

The reference module is **already domain-agnostic** — it has no `apex-log-parser` import, no `TimedNodeProp`, and no timestamp logic. The fallback strategy in §7 uses only public Tabulator APIs (`getTreeParent()`, `getDisplayRows()`).

## 9. Test contract

Test cases the upstream suite should cover. Each is a starting set, not exhaustive; downstream `ScrollAnchor.test.ts` has them implemented against jest mocks and is a useful reference shape:

1. `findMiddleVisibleRow` returns the row whose cumulative intersected height first crosses half the holder height.
2. Single tree toggle does not change `scrollTop` and does not call any scroll API.
3. Bulk tree toggle (≥2 synchronous toggles) clears the skip flag so the recentering path runs.
4. Sort capture happens in `dataSorting` (not `renderStarted`); confirm by changing the visible row set between the two events and asserting the captured anchor is the pre-sort row.
5. `wasAtTop` / `wasAtBottom` are captured correctly at boundary scrollTop values.
6. On `renderComplete`, `wasAtTop` snaps `scrollTop` to `0` and skips pixel-anchoring.
7. On `renderComplete`, `wasAtBottom` snaps `scrollTop` to `scrollHeight - clientHeight`.
8. Pixel-accurate restore: pre-render `(rowOffsetTop=A, scrollTop=B) → captured offset=(A-B)`. Post-render `rowOffsetTop=A'` → `scrollTop = A' - (A-B)`. Assert synchronously after the `renderComplete` call (no awaits) — proves the restore is sync.
9. Filter padding regression (cause-side fix from §6): filter a long list to a short list, assert `.tabulator-table` `paddingTop` is `0` after.
10. Filter padding **negative case** (symptom-side detection): when `scrollTop >= paddingTop` the user has legitimately scrolled past the padding; assert the detection does **not** clobber it (`ScrollAnchor.test.ts:287`).
11. Anchor row fallback — collapse: the captured row is not in `displayRows` but its tree parent is; assert `_resolveAnchorRow` returns the parent.
12. Anchor row fallback — filter (clamped): the captured row is gone, no displayed ancestor, captured `anchorDisplayIndex` exceeds the new `displayRows.length`; assert restore picks the row at `displayRows.length - 1`.
13. Anchor row fallback — filter (exact index): same as above with the captured index in range; assert restore picks the row at exactly that index.
14. Anchor row fallback — exhausted: no displayed ancestor and empty `displayRows`; assert `_resolveAnchorRow` returns `null` and the restore is a no-op.
15. Fits-in-viewport (covered by case 6, no dedicated test) — when content fits (`scrollHeight ≤ clientHeight`), the browser forces `scrollTop = 0`, which makes `wasAtTop` true and the `wasAtTop` snap path runs. Case 6 already exercises that path; this entry exists to document the behavioural guarantee, not as a separate test obligation.

## 10. Open questions for the upstream PR author

- **Module / option name.** `scrollAnchor` matches the downstream prototype, but `virtualScrollAnchor` or `anchorScroll` might fit Tabulator naming better.
- **Boundary threshold configurability.** Ship the constant or expose `boundaryThresholdPx` as a sub-option from day one? Current downstream usage has not needed an override.
- **Filter padding fix coupling.** Land the `rerenderRows` clamp (§6) in the same PR as the module, or split into two PRs (the clamp is independently useful)?
- **Pre-sort hook.** Is upstream willing to add `dataSortInitiated` / `beforeSort` so the module has one capture site instead of two? Without it, the duplication remains.
- **Public API naming.** `RowManager.includes(component)` vs `RowComponent.getInternal()` for the private-API replacement in §5.1; `renderer.ensureRendered(index)` vs a more general `renderer.refillAround(index)` for §5.2.

## 11. Performance budget

For reviewers asking "what does this cost per render?":

- **Off-state cost (option not set)**: zero. `initialize()` returns without subscribing to any events when `options.scrollAnchor` is falsy (default). No listeners on the bus, no `getRows` calls, no `getBoundingClientRect` reads.
- **Capture cost (per render, when on)**:
  - One `getRows('visible')` — bounded by viewport height ÷ row height, typically <50 rows for any realistic table.
  - One `getBoundingClientRect()` on the holder + one per visible row inside `_findMiddleVisibleRow`. All reads happen back-to-back at the start of the operation, so the browser batches them into a single layout flush (no read/write interleave).
  - One `getDisplayRows().indexOf(...)` to capture `anchorDisplayIndex` (linear scan, O(display rows)). Use a Map if upstream wants O(1).
- **Restore cost (per render)**: one `offsetTop` read on the anchor row + one `scrollTop` write. `_virtualRenderFill` only runs when the anchor row's DOM element is detached after the new vDom window — rare in practice.
- **Memory**: a handful of primitive fields on the module instance (anchor row reference, offset, two booleans, two flags). One stored rAF handle while a filter is in flight.

Net: invisible at common table sizes, and zero impact when the feature is off. The upstream PR should include a benchmark or jsperf for the capture path so the cost is documented rather than assumed.

## References

- Reference implementation: `log-viewer/src/tabulator/module/ScrollAnchor.ts`.
- Reference tests: `log-viewer/src/tabulator/module/__tests__/ScrollAnchor.test.ts`.
- Upstream filter bug location: `tabulator_esm.mjs` line ~25265 (v6.4.0) (`rerenderRows`).
