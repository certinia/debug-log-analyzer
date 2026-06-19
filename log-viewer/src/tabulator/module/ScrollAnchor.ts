/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';

const scrollAnchorOption = 'scrollAnchor' as const;

/**
 * ⚠️ STOCK-RENDERER FALLBACK — NOT REGISTERED.
 *
 * The call-tree views use the custom `VirtualVerticalRenderer` with the
 * `AnchoringPolicy` module; this module is the last version that worked with
 * Tabulator's STOCK `VirtualDomVertical` renderer (restored from commit
 * 7cdf35e5, the parent of the custom-renderer commit), kept in source so the
 * stock renderer can be reinstated quickly if ever needed.
 *
 * To switch a call-tree view back to the stock renderer:
 *   1. Remove `renderVertical: VirtualVerticalRenderer` and
 *      `anchoringPolicy: true` from the table config.
 *   2. Register this module in `TableShared.registerTableModules()` and set
 *      `scrollAnchor: true` in the table config.
 *   3. Uncomment the `_centerRow`/`_isVisible` workaround in
 *      `RowNavigation` (the methods and their call in `_scrollToRow`).
 *
 * Pixel-accurate, data-agnostic scroll anchoring across table re-renders.
 *
 * Capture (renderStarted): the middle visible row, its Y offset inside the
 * holder, and its index in `getDisplayRows()`. Restore (renderComplete, fully
 * synchronous): set scrollTop so the same row sits at the same pixel — no
 * visible jump. If the anchor row was filtered or collapsed out, fall back to
 * the nearest displayed tree ancestor, then to the row at the captured
 * display-index clamped to the new display length.
 *
 * Enable by registering the module and setting `scrollAnchor: true` in table options.
 */
export class ScrollAnchor extends Module {
  static moduleName = 'scrollAnchor';

  tableHolder: HTMLElement | null = null;
  private tableEl: HTMLElement | null = null;
  anchorRow: RowComponent | null = null;
  private anchorOffsetFromHolderTop = 0;
  private anchorDisplayIndex = -1;

  // Single tree toggle: skip the next renderComplete recenter so scrollTop stays put.
  // Bulk toggle (expand-all / collapse-all): the second toggle in the synchronous burst
  // clears the skip flag, so the recenter runs as before.
  private skipNextRender = false;
  private toggleSeenInBurst = false;

  // Boundary anchoring: when the user is at the top or bottom of the scroll range
  // before an operation, recentering pushes them away from the edge they were at.
  // Capture the boundary at snapshot time and restore it instead of pixel-anchoring.
  private static readonly boundaryThresholdPx = 10;
  private wasAtTop = false;
  private wasAtBottom = false;

  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption(scrollAnchorOption, false);
  }

  initialize() {
    // @ts-expect-error not in types
    if (this.options(scrollAnchorOption)) {
      this.tableHolder = this.table.element.querySelector('.tabulator-tableholder');

      this.table.on('dataTreeRowExpanded', () => this._onTreeToggle());
      this.table.on('dataTreeRowCollapsed', () => this._onTreeToggle());

      // Capture once per render-cycle. Our custom VariableHeightVerticalRenderer
      // preserves scrollTop across sort/filter in rerenderRows, so renderStarted
      // fires with the correct pre-render scrollTop — a single source of capture,
      // one fewer subscription firing per sort than the old dataSorting + renderStarted pair.
      this.table.on('renderStarted', () => this._captureAnchor());

      this.table.on('renderComplete', () => {
        // Reset stale paddings BEFORE restore: paddingTop affects the rendered
        // window position, and paddingBottom contributes to scrollHeight which
        // the was-at-bottom boundary restore reads.
        this._resetStaleTopPadding();
        this._resetStaleBottomPadding();
        if (this.skipNextRender) {
          this.skipNextRender = false;
          this._clearAnchor();
        } else {
          this._restoreAnchor();
        }
        this.toggleSeenInBurst = false;
      });
    }
  }

  /**
   * Capture the user's scroll anchor: the middle visible row, its Y offset inside
   * the holder, and whether the user was at the top / bottom edge. Idempotent
   * within one operation — subsequent calls are no-ops once an anchor is set.
   */
  private _captureAnchor() {
    if (!this.tableHolder || this.anchorRow) {
      return;
    }
    const holder = this.tableHolder;
    const max = Math.max(0, holder.scrollHeight - holder.clientHeight);
    this.wasAtTop = holder.scrollTop <= ScrollAnchor.boundaryThresholdPx;
    this.wasAtBottom = max - holder.scrollTop <= ScrollAnchor.boundaryThresholdPx;

    const row = this._findMiddleVisibleRow(holder);
    this.anchorRow = row;
    if (row) {
      // offsetTop is relative to the offsetParent (.tabulator-table); subtracting
      // scrollTop gives the row's Y position inside the holder viewport — same
      // result as paired getBoundingClientRect calls without forcing layout reads.
      this.anchorOffsetFromHolderTop = row.getElement().offsetTop - holder.scrollTop;
      // @ts-expect-error _getSelf is private to tabulator, but we have no other choice atm.
      this.anchorDisplayIndex = this.table.rowManager.getDisplayRows().indexOf(row._getSelf());
    }
  }

  /**
   * Restore the captured anchor synchronously. Boundary cases (was-at-top /
   * was-at-bottom) snap to the edge. Mid-table sets scrollTop so the anchor row
   * sits at exactly the same Y pixel it occupied pre-render — no flash.
   */
  private _restoreAnchor() {
    const holder = this.tableHolder;
    if (!holder) {
      this._clearAnchor();
      return;
    }
    if (this.wasAtTop) {
      holder.scrollTop = 0;
    } else if (this.wasAtBottom) {
      holder.scrollTop = Math.max(0, holder.scrollHeight - holder.clientHeight);
    } else {
      this._anchorPixelAccurate(holder);
    }
    this._clearAnchor();
  }

  private _clearAnchor() {
    this.anchorRow = null;
    this.anchorOffsetFromHolderTop = 0;
    this.anchorDisplayIndex = -1;
    this.wasAtTop = false;
    this.wasAtBottom = false;
  }

  /**
   * Synchronous, pixel-accurate scroll anchor restore.
   *
   * If the anchor row is outside the post-render virtual DOM window its element
   * is detached and `offsetTop` is stale. Call Tabulator's private
   * `_virtualRenderFill` (same hook the public `scrollToRow` uses) to refill the
   * vDom centered on the row, then set scrollTop in the same JS turn as
   * renderComplete — the browser paints the corrected position directly.
   */
  private _anchorPixelAccurate(holder: HTMLElement) {
    const row = this._resolveAnchorRow();
    if (!row) {
      return;
    }

    const rowEl = row.getElement();
    if (!rowEl.isConnected) {
      const renderer = this.table.rowManager.renderer as Record<string, unknown> | undefined;
      // @ts-expect-error _getSelf is private to tabulator, but we have no other choice atm.
      const internalRow = row._getSelf() as unknown;
      const rendererRows = (renderer?.rows as (() => unknown[]) | undefined)?.();
      const fill = renderer?._virtualRenderFill as
        | ((index: number, force?: boolean) => void)
        | undefined;
      if (rendererRows && fill) {
        const index = rendererRows.indexOf(internalRow);
        if (index > -1) {
          fill.call(renderer, index, true);
        }
      }
    }

    holder.scrollTop = Math.max(0, rowEl.offsetTop - this.anchorOffsetFromHolderTop);
  }

  /**
   * Resolve the anchor row in the post-render display set. If it was filtered
   * or collapsed away, fall back to the nearest displayed tree ancestor, then
   * to the row at the captured display-index clamped to the new display length.
   */
  private _resolveAnchorRow(): RowComponent | null {
    const row = this.anchorRow;
    if (!row) {
      return null;
    }
    const displayRows = this.table.rowManager.getDisplayRows();
    if (this._isRowActive(row, displayRows)) {
      return row;
    }

    let parent = row.getTreeParent();
    while (parent) {
      if (this._isRowActive(parent, displayRows)) {
        return parent;
      }
      parent = parent.getTreeParent();
    }

    if (this.anchorDisplayIndex >= 0 && displayRows.length > 0) {
      const idx = Math.min(this.anchorDisplayIndex, displayRows.length - 1);
      const internalRow = displayRows[idx];
      if (internalRow) {
        return (internalRow as unknown as { getComponent: () => RowComponent }).getComponent();
      }
    }

    return null;
  }

  private _isRowActive(row: RowComponent, displayRows: RowComponent[]): boolean {
    // @ts-expect-error _getSelf is private to tabulator, but we have no other choice atm.
    const internalRow = row._getSelf();
    return displayRows.indexOf(internalRow) !== -1;
  }

  /**
   * Tabulator bug workaround: after a filter, rerenderRows() (`tabulator_esm.mjs`,
   * line ~25265) iterates pre-filter `vDomTop..vDomBottom` against the post-filter
   * `rows()` array. The resulting `topOffset` flows into `_virtualRenderFill` and
   * inflates `vDomTopPad` → `paddingTop` on `.tabulator-table` → blank strip across
   * the top of the holder. We detect the symptom (`scrollTop < paddingTop`, which
   * implies more empty space above the rendered window than the user has scrolled
   * past) and reset the padding plus Tabulator's internal `vDomTopPad` so future
   * renders are coherent.
   */
  private _resetStaleTopPadding() {
    if (!this.tableHolder) {
      return;
    }
    if (!this.tableEl) {
      this.tableEl = this.tableHolder.querySelector('.tabulator-table');
    }
    const tableEl = this.tableEl;
    if (!tableEl) {
      return;
    }
    const paddingTop = parseFloat(tableEl.style.paddingTop) || 0;
    const scrollTop = this.tableHolder.scrollTop;
    if (paddingTop > 0 && scrollTop < paddingTop) {
      tableEl.style.paddingTop = '0px';
      const renderer = this.table.rowManager?.renderer as Record<string, unknown> | undefined;
      if (renderer) {
        renderer.vDomTopPad = 0;
      }
    }
  }

  /**
   * Tabulator bug workaround: when the last display row is in the rendered
   * window, `vDomBottomPad` must be 0 by definition — but `_virtualRenderFill`'s
   * "position" branch can leave it non-zero because it derives the pad from a
   * stale `vDomScrollHeight` (only updated by the "no-position" branch). The
   * symptom is a blank strip below the last row after sort / filter / tree
   * toggle / resize. See `tabulator-virtual-scroll-fixes.md` "Fix 8" for the
   * upstream patch.
   */
  private _resetStaleBottomPadding() {
    if (!this.tableHolder) {
      return;
    }
    if (!this.tableEl) {
      this.tableEl = this.tableHolder.querySelector('.tabulator-table');
    }
    const tableEl = this.tableEl;
    if (!tableEl) {
      return;
    }
    const renderer = this.table.rowManager?.renderer as Record<string, unknown> | undefined;
    if (!renderer) {
      return;
    }

    const rowsCount = this.table.rowManager?.getDisplayRows?.()?.length ?? 0;
    const vDomBottom = (renderer.vDomBottom as number) ?? 0;
    if (rowsCount === 0 || vDomBottom < rowsCount - 1) {
      return;
    }
    const actualPad = parseFloat(tableEl.style.paddingBottom) || 0;
    if (actualPad > 0) {
      tableEl.style.paddingBottom = '0px';
      renderer.vDomBottomPad = 0;
    }
  }

  private _onTreeToggle() {
    if (!this.toggleSeenInBurst) {
      this.toggleSeenInBurst = true;
      this.skipNextRender = true;
    } else {
      this.skipNextRender = false;
    }
    this._clearAnchor();
  }

  private _findMiddleVisibleRow(tableHolder: HTMLElement) {
    const visibleRows = this.table.getRows('visible');
    const len = visibleRows.length;
    if (len === 0) {
      return null;
    } else if (len === 1) {
      return visibleRows[0] ?? null;
    }

    const tableRect = tableHolder.getBoundingClientRect();
    const totalHeight = Math.round(tableRect.height / 2);

    let currentHeight = 0;
    for (const row of visibleRows) {
      const elementRect = row.getElement().getBoundingClientRect();

      const topDiff = tableRect.top - elementRect.top;
      currentHeight += topDiff > 0 ? elementRect.height - topDiff : elementRect.height;

      const bottomDiff = elementRect.bottom - tableRect.bottom;
      currentHeight -= bottomDiff > 0 ? bottomDiff : 0;

      if (Math.round(currentHeight) >= totalHeight) {
        return row;
      }
    }
    return null;
  }
}
