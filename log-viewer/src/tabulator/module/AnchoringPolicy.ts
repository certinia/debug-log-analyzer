/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';

const anchoringPolicyOption = 'anchoringPolicy' as const;

interface AnchorableRenderer {
  setAnchor?: (row: unknown, offsetFromHolderTop: number) => void;
}

/**
 * Anchoring policy: decides WHICH row to keep visually stable across a
 * structural re-render (sort / filter / tree toggle) and delegates the HOW to
 * the renderer's `setAnchor` reconcile primitive. The renderer itself only
 * renders and retains relative scroll position (VirtualVerticalRenderer
 * Stage 2d contract) — this module is the single anchoring owner.
 *
 * Lifecycle (all synchronous within one Tabulator operation, pre-paint):
 *  1. `renderStarted` — capture scrollTop, top/bottom edge proximity, and each
 *     visible row's offset inside the holder (the future toggled row is among
 *     them). First capture per cycle wins.
 *  2. `renderComplete` — GENERIC restore: snap to the edge the user was at,
 *     else re-anchor the middle visible row (sort/filter case). The capture is
 *     kept: a tree toggle refines it in the same task.
 *  3. `dataTreeRowExpanded` / `dataTreeRowCollapsed` — PRECISE restore:
 *     Tabulator dispatches these AFTER `refreshData` (tabulator_esm.mjs
 *     ~4674–4700) but synchronously before paint, finally identifying the
 *     clicked row. If it was visible at capture, pin it back to its exact
 *     captured offset (edges still win). Consumes the capture.
 *  4. A `queueMicrotask` after `renderComplete` clears any unconsumed capture,
 *     so state never leaks across tasks. Bulk toggles under `blockRedraw`
 *     fire dataTree events with renders deferred → no capture → ignored; the
 *     single `restoreRedraw` render gets one generic restore.
 */
export class AnchoringPolicy extends Module {
  static moduleName = 'anchoringPolicy';

  tableHolder: HTMLElement | null = null;

  // Edge proximity: if the user was within this many px of the top/bottom
  // edge, re-pin to that edge rather than replaying a row offset (a captured
  // offset near the bottom is often unachievable after the row count changes).
  private static readonly boundaryThresholdPx = 10;

  private capture: {
    wasAtTop: boolean;
    wasAtBottom: boolean;
    // Internal Row → its `offsetTop − scrollTop` (Y inside the holder).
    offsets: Map<unknown, number>;
    middleRow: RowComponent | null;
  } | null = null;

  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption(anchoringPolicyOption, false);
  }

  initialize() {
    // @ts-expect-error not in types
    if (this.options(anchoringPolicyOption)) {
      this.tableHolder = this.table.element.querySelector('.tabulator-tableholder');
      this.table.on('renderStarted', () => this._captureAnchor());
      this.table.on('renderComplete', () => this._genericRestore());
      this.table.on('dataTreeRowExpanded', (row: RowComponent) => this._preciseRestore(row));
      this.table.on('dataTreeRowCollapsed', (row: RowComponent) => this._preciseRestore(row));
    }
  }

  /** Capture the pre-render viewport state. Idempotent within one cycle. */
  private _captureAnchor() {
    const holder = this.tableHolder;
    if (!holder || this.capture) {
      return;
    }
    const scrollTop = holder.scrollTop;
    const max = Math.max(0, holder.scrollHeight - holder.clientHeight);

    const offsets = new Map<unknown, number>();
    const visibleRows = this.table.getRows('visible');
    for (const row of visibleRows) {
      // offsetTop is relative to the offsetParent (.tabulator-table);
      // subtracting scrollTop gives the row's Y inside the holder viewport.
      offsets.set(this._internal(row), row.getElement().offsetTop - scrollTop);
    }

    this.capture = {
      wasAtTop: scrollTop <= AnchoringPolicy.boundaryThresholdPx,
      wasAtBottom: max - scrollTop <= AnchoringPolicy.boundaryThresholdPx,
      offsets,
      middleRow: this._findMiddleVisibleRow(holder, visibleRows),
    };
  }

  /**
   * Generic restore at renderComplete: edge snap, else middle-row re-anchor
   * (the sort/filter case). Keeps the capture so a tree-toggle event in the
   * same task can refine it; schedules a microtask sweep so it never leaks.
   */
  private _genericRestore() {
    const holder = this.tableHolder;
    const capture = this.capture;
    if (!holder || !capture) {
      return;
    }

    if (capture.wasAtTop) {
      holder.scrollTop = 0;
    } else if (capture.wasAtBottom) {
      holder.scrollTop = Math.max(0, holder.scrollHeight - holder.clientHeight);
    } else if (capture.middleRow) {
      // The captured offset belongs to the ORIGINAL middle row; if it was
      // filtered/collapsed away, the nearest surviving ancestor takes its
      // place at that same offset (the ancestor itself may never have been
      // visible, so it has no captured offset of its own).
      const offset = capture.offsets.get(this._internal(capture.middleRow));
      const row = this._resolveRow(capture.middleRow);
      if (row && offset !== undefined) {
        this._anchorViaRenderer(row, offset);
      }
    }

    // The dataTree events (if this was a toggle) fire later in this same task;
    // the microtask runs after it and clears whatever remains.
    queueMicrotask(() => {
      this.capture = null;
    });
  }

  /**
   * Precise restore on dataTreeRowExpanded/Collapsed: pin the CLICKED row back
   * to its exact captured offset (overriding the generic middle-row restore;
   * edges still win). No capture (e.g. bulk toggles under blockRedraw, where
   * renders are deferred) → no-op.
   */
  private _preciseRestore(toggledRow: RowComponent) {
    const capture = this.capture;
    this.capture = null; // one-shot
    if (!capture || capture.wasAtTop || capture.wasAtBottom) {
      return;
    }
    const row = this._resolveRow(toggledRow);
    if (!row) {
      return;
    }
    const offset = capture.offsets.get(this._internal(row));
    if (offset === undefined) {
      // Toggled row wasn't visible pre-toggle (programmatic) — the generic
      // restore already produced a sane position.
      return;
    }
    this._anchorViaRenderer(row, offset);
  }

  /** Delegate to the renderer's anchoring primitive. */
  private _anchorViaRenderer(row: RowComponent, offsetFromHolderTop: number) {
    const renderer = this.table.rowManager?.renderer as AnchorableRenderer | undefined;
    if (!renderer?.setAnchor) {
      return;
    }
    renderer.setAnchor(this._internal(row), offsetFromHolderTop);
  }

  /**
   * Resolve a captured row in the post-render display set. If it was filtered
   * or collapsed away, fall back to the nearest displayed tree ancestor.
   */
  private _resolveRow(row: RowComponent | null): RowComponent | null {
    if (!row) {
      return null;
    }
    const displayRows = this.table.rowManager.getDisplayRows();
    if (displayRows.indexOf(this._internal(row)) !== -1) {
      return row;
    }
    let parent = row.getTreeParent();
    while (parent) {
      if (displayRows.indexOf(this._internal(parent)) !== -1) {
        return parent;
      }
      parent = parent.getTreeParent();
    }
    return null;
  }

  private _internal(row: RowComponent): unknown {
    // @ts-expect-error _getSelf is private to tabulator, but we have no other choice atm.
    return row._getSelf();
  }

  /** The row whose cumulative visible height first crosses half the holder. */
  private _findMiddleVisibleRow(
    tableHolder: HTMLElement,
    visibleRows: RowComponent[],
  ): RowComponent | null {
    const len = visibleRows.length;
    if (len === 0) {
      return null;
    } else if (len === 1) {
      return visibleRows[0] ?? null;
    }

    const tableRect = tableHolder.getBoundingClientRect();
    const targetHeight = Math.round(tableRect.height / 2);

    let currentHeight = 0;
    for (const row of visibleRows) {
      const elementRect = row.getElement().getBoundingClientRect();

      const topDiff = tableRect.top - elementRect.top;
      currentHeight += topDiff > 0 ? elementRect.height - topDiff : elementRect.height;

      const bottomDiff = elementRect.bottom - tableRect.bottom;
      currentHeight -= bottomDiff > 0 ? bottomDiff : 0;

      if (Math.round(currentHeight) >= targetHeight) {
        return row;
      }
    }
    return null;
  }
}
