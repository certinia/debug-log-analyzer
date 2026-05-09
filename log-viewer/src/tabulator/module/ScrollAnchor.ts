/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';

type TimedNodeProp = { originalData: LogEvent };

const scrollAnchorOption = 'scrollAnchor' as const;

/**
 * Pixel-accurate scroll anchoring across table re-renders.
 *
 * Capture (renderStarted / dataSorting): the middle visible row and its Y offset
 * inside the holder. Restore (renderComplete, fully synchronous): set scrollTop
 * so the same row sits at the same pixel — no visible jump.
 *
 * Enable by registering the module and setting `scrollAnchor: true` in table options.
 */
export class ScrollAnchor extends Module {
  static moduleName = 'scrollAnchor';

  tableHolder: HTMLElement | null = null;
  private tableEl: HTMLElement | null = null;
  anchorRow: RowComponent | null = null;
  private anchorOffsetFromHolderTop = 0;
  private pendingFilterRaf: number | null = null;

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

      // Sort resets scrollTop before renderStarted fires, so capture the anchor here
      // (pre-sort) instead. The renderStarted handler below is a no-op once anchorRow
      // is set — see the !this.anchorRow guard.
      this.table.on('dataSorting', () => this._captureAnchor());

      this.table.on('renderStarted', () => this._captureAnchor());

      // Tabulator bug workaround: rerenderRows on filter can leave .tabulator-table's
      // paddingTop inflated when the pre-filter vDomTop/vDomBottom point past the
      // post-filter row count. Detect and zero on the next frame after the render.
      // See tabulator-virtual-scroll-fixes.md "Fix 7" for the upstream patch.
      this.table.on('dataFiltered', () => {
        if (this.pendingFilterRaf !== null) {
          cancelAnimationFrame(this.pendingFilterRaf);
        }
        this.pendingFilterRaf = requestAnimationFrame(() => {
          this.pendingFilterRaf = null;
          this._resetStaleTopPadding();
        });
      });

      this.table.on('renderComplete', () => {
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
   * Pick the row to anchor on after the render. Prefer the originally captured
   * row; if it has been filtered/collapsed away, fall back to the nearest active
   * row by timestamp so the user keeps their place.
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

    const timestamp = (row.getData() as TimedNodeProp).originalData?.timestamp;
    if (timestamp === undefined) {
      return null;
    }
    return this._findClosestActive(this.table.getRows('active'), timestamp, displayRows);
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

  private _onTreeToggle() {
    if (!this.toggleSeenInBurst) {
      this.toggleSeenInBurst = true;
      this.skipNextRender = true;
    } else {
      this.skipNextRender = false;
    }
    this._clearAnchor();
  }

  private _findClosestActive(
    rows: RowComponent[],
    timeStamp: number,
    displayRows: RowComponent[] = this.table.rowManager.getDisplayRows(),
  ): RowComponent | null {
    if (!rows) {
      return null;
    }

    let start = 0,
      end = rows.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const row = rows[mid];

      if (!row) {
        break;
      }
      const node = (row.getData() as TimedNodeProp).originalData;
      const endTime = node.exitStamp ?? node.timestamp;

      if (timeStamp === node.timestamp) {
        if (this._isRowActive(row, displayRows)) {
          return row;
        }

        return this._findClosestActiveSibling(mid, rows, displayRows);
      } else if (timeStamp >= node.timestamp && timeStamp <= endTime) {
        const childMatch = this._findClosestActive(
          row.getTreeChildren() ?? [],
          timeStamp,
          displayRows,
        );
        if (childMatch) {
          return childMatch;
        }
        return this._findClosestActiveSibling(mid, rows, displayRows);
      } else if (timeStamp > endTime) {
        start = mid + 1;
      } else if (timeStamp < node.timestamp) {
        end = mid - 1;
      } else {
        return null;
      }
    }

    return null;
  }

  private _findClosestActiveSibling(
    midIndex: number,
    rows: RowComponent[],
    activeRows: RowComponent[],
  ) {
    const indexes = [];

    let previousIndex = midIndex;
    let previousVisible;
    while (previousIndex >= 0) {
      previousVisible = rows[previousIndex];
      if (!previousVisible) {
        continue;
      }
      if (this._isRowActive(previousVisible, activeRows)) {
        indexes.push(previousIndex);
        break;
      }

      previousIndex--;
    }

    const distanceFromMid = previousIndex > -1 ? midIndex - previousIndex : midIndex;

    const len = rows.length;
    let nextIndex = midIndex;
    let nextVisible;
    while (nextIndex >= 0 && nextIndex !== len && nextIndex - midIndex < distanceFromMid) {
      nextVisible = rows[nextIndex];
      if (!nextVisible) {
        continue;
      }
      if (this._isRowActive(nextVisible, activeRows)) {
        indexes.push(nextIndex);
        break;
      }
      nextIndex++;
    }

    const closestIndex = indexes.length
      ? indexes.reduce((a, b) => {
          return Math.abs(b - midIndex) < Math.abs(a - midIndex) ? b : a;
        })
      : null;

    return closestIndex ? rows[closestIndex] || null : null;
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
