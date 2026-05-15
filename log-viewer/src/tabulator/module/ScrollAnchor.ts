/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';

const scrollAnchorOption = 'scrollAnchor' as const;

interface AnchorableRenderer {
  setAnchor?: (row: unknown, offsetFromHolderTop: number) => void;
}

/**
 * Opt-in semantic scroll anchoring: keep the MIDDLE visible row in place
 * across re-renders (sort / filter / dataTree toggle), instead of the
 * renderer's default top-row preservation.
 *
 * Enable with `scrollAnchor: true` in the table options.
 *
 * Architecture:
 *
 *   - The renderer (e.g. VariableHeightVerticalRenderer) owns scrollTop
 *     preservation across rerenders by default. This module never rescues
 *     a broken scrollTop.
 *   - This module captures the middle visible row pre-render and calls
 *     `renderer.setAnchor(row, offsetY)` post-render to refine — moving
 *     the anchor from the viewport top (renderer default) to the captured
 *     middle position.
 *
 * Boundary cases (at-top / at-bottom snap) and tree-toggle skip (single
 * toggle should preserve scrollTop, not recenter) layer on top of that
 * one primitive.
 */
export class ScrollAnchor extends Module {
  static moduleName = 'scrollAnchor';

  tableHolder: HTMLElement | null = null;
  anchorRow: RowComponent | null = null;
  private anchorOffsetFromHolderTop = 0;

  // Single tree toggle: skip the next renderComplete recenter so scrollTop stays put.
  // Bulk toggle (expand-all / collapse-all): the second toggle in the synchronous burst
  // clears the skip flag, so the recenter runs as before.
  private skipNextRender = false;
  private toggleSeenInBurst = false;

  // Boundary anchoring: when the user is at the top or bottom of the scroll range
  // before an operation, recentering pushes them away from the edge they were at.
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

      this.table.on('renderStarted', () => this._captureAnchor());
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
   * within one operation.
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
      // scrollTop gives the row's Y position inside the holder viewport.
      this.anchorOffsetFromHolderTop = row.getElement().offsetTop - holder.scrollTop;
    }
  }

  /**
   * Restore the captured anchor by delegating to the renderer's setAnchor.
   * Boundary cases snap to edge.
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
      this._anchorViaRenderer();
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
   * Delegate to the renderer's single anchoring primitive. If the captured
   * row was filtered/collapsed out, walk to the nearest surviving tree
   * ancestor; if none, the renderer's default top-row preservation already
   * runs, and we leave scrollTop alone.
   */
  private _anchorViaRenderer() {
    const row = this._resolveAnchorRow();
    if (!row) {
      return;
    }

    const renderer = this.table.rowManager?.renderer as AnchorableRenderer | undefined;
    if (!renderer?.setAnchor) {
      return;
    }

    // @ts-expect-error _getSelf is private to tabulator, but we have no other choice atm.
    const internalRow = row._getSelf();
    renderer.setAnchor(internalRow, this.anchorOffsetFromHolderTop);
  }

  /**
   * Resolve the anchor row in the post-render display set. If it was filtered
   * or collapsed away, fall back to the nearest displayed tree ancestor.
   *
   * Cedes control (returns null) when no surviving anchor exists. The
   * renderer's default top-row preservation already produced a sane
   * scrollTop — leaving it alone is the right answer.
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

    return null;
  }

  private _isRowActive(row: RowComponent, displayRows: RowComponent[]): boolean {
    // @ts-expect-error _getSelf is private to tabulator, but we have no other choice atm.
    const internalRow = row._getSelf();
    return displayRows.indexOf(internalRow) !== -1;
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
