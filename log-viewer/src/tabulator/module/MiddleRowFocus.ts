/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';

type TimedNodeProp = { originalData: LogEvent };

const middleRowFocusOption = 'middleRowFocus' as const;
/**
 * Enable MiddleRowFocus by importing the class and calling
 * Tabulator.registerModule(MiddleRowFocus); before the first instantiation of the table.
 * Then enable by setting middleRowFocus to true in table config.
 * To disable RowNavigation set middleRowFocus to false in table options.
 */
export class MiddleRowFocus extends Module {
  static moduleName = 'middleRowFocus';

  tableHolder: HTMLElement | null = null;
  private tableEl: HTMLElement | null = null;
  middleRow: RowComponent | null = null;
  private pendingFilterRaf: number | null = null;

  // Single tree toggle: skip the next renderComplete recenter so scrollTop stays put.
  // Bulk toggle (expand-all / collapse-all): the second toggle in the synchronous burst
  // clears the skip flag, so the recenter runs as before.
  private skipNextRender = false;
  private toggleSeenInBurst = false;

  // Boundary anchoring: when the user is at the top or bottom of the scroll range
  // before an operation, recentering on the middle row pushes them away from the
  // edge they were at. Capture the boundary at snapshot time and restore it
  // (scrollTop = 0 / scrollHeight - clientHeight) instead of centering.
  private static readonly boundaryThresholdPx = 10;
  private wasAtTop = false;
  private wasAtBottom = false;

  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption(middleRowFocusOption, false);
  }

  initialize() {
    // @ts-expect-error not in types
    if (this.options(middleRowFocusOption)) {
      this.tableHolder = this.table.element.querySelector('.tabulator-tableholder');

      this.table.on('dataTreeRowExpanded', () => this._onTreeToggle());
      this.table.on('dataTreeRowCollapsed', () => this._onTreeToggle());

      // Sort resets scrollTop before renderStarted fires, so capture the anchor here
      // (pre-sort) instead. The renderStarted handler below is a no-op once middleRow
      // is set — see the !this.middleRow guard.
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

      this.table.on('renderComplete', async () => {
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
   * Capture the user's scroll anchor: the row at the visual middle and whether
   * the user was at the top / bottom edge. Idempotent within one operation —
   * subsequent calls are no-ops once an anchor is already set.
   */
  private _captureAnchor() {
    if (!this.tableHolder || this.middleRow) {
      return;
    }
    const holder = this.tableHolder;
    const max = Math.max(0, holder.scrollHeight - holder.clientHeight);
    this.wasAtTop = holder.scrollTop <= MiddleRowFocus.boundaryThresholdPx;
    this.wasAtBottom = max - holder.scrollTop <= MiddleRowFocus.boundaryThresholdPx;
    this.middleRow = this._findMiddleVisibleRow(holder);
  }

  /**
   * Restore the captured anchor. Boundary cases (was-at-top / was-at-bottom) snap
   * to the edge so we don't push the user off it. Mid-table centers on middleRow.
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
      this._scrollToRow(this.middleRow);
    }
    this._clearAnchor();
  }

  private _clearAnchor() {
    this.middleRow = null;
    this.wasAtTop = false;
    this.wasAtBottom = false;
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
      // First toggle in this burst: assume single, arm the skip.
      this.toggleSeenInBurst = true;
      this.skipNextRender = true;
    } else {
      // A second toggle arrived synchronously => it's a bulk operation; let the
      // existing recenter run so the user's middle row stays in view.
      this.skipNextRender = false;
    }
    // Clear the anchor so renderStarted captures fresh (with up-to-date boundary flags).
    this._clearAnchor();
  }

  private _scrollToRow(row: RowComponent | null) {
    if (!row) {
      return;
    }

    let rowToScrollTo: RowComponent | null = row;
    if (rowToScrollTo?.getData) {
      const displayRows = this.table.rowManager.getDisplayRows();
      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = rowToScrollTo._getSelf();
      const canScroll = displayRows.indexOf(internalRow) !== -1;
      if (!canScroll) {
        const rowData = rowToScrollTo.getData() as TimedNodeProp;
        const node = rowData.originalData;

        rowToScrollTo = this._findClosestActive(this.table.getRows('active'), node.timestamp);
      }

      if (rowToScrollTo) {
        this.table.scrollToRow(rowToScrollTo, 'center', true).then(() => {
          setTimeout(() => {
            rowToScrollTo
              ?.getElement()
              .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
          });
        });
      }
    }
  }

  private _findClosestActive(rows: RowComponent[], timeStamp: number): RowComponent | null {
    if (!rows) {
      return null;
    }

    let start = 0,
      end = rows.length - 1;

    // Iterate as long as the beginning does not encounter the end.
    const displayRows = this.table.rowManager.getDisplayRows();
    while (start <= end) {
      // find out the middle index
      const mid = Math.floor((start + end) / 2);
      const row = rows[mid];

      if (!row) {
        break;
      }
      const node = (row.getData() as TimedNodeProp).originalData;
      const endTime = node.exitStamp ?? node.timestamp;

      if (timeStamp === node.timestamp) {
        //@ts-expect-error This is private to tabulator, but we have no other choice atm.
        const internalRow = row._getSelf();
        const isActive = displayRows.indexOf(internalRow) !== -1;
        if (isActive) {
          return row;
        }

        return this._findClosestActiveSibling(mid, rows, displayRows);
      } else if (timeStamp >= node.timestamp && timeStamp <= endTime) {
        const childMatch = this._findClosestActive(row.getTreeChildren() ?? [], timeStamp);
        if (childMatch) {
          return childMatch;
        }
        return this._findClosestActiveSibling(mid, rows, displayRows);
      }
      // Otherwise, look in the left or right half
      else if (timeStamp > endTime) {
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
      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = previousVisible._getSelf();
      const isActive = activeRows.indexOf(internalRow) !== -1;
      if (previousVisible && isActive) {
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

      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = nextVisible._getSelf();
      const isActive = activeRows.indexOf(internalRow) !== -1;
      if (nextVisible && isActive) {
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
