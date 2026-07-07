/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import type { Tabulator } from 'tabulator-tables';
import { Module, type RowComponent } from 'tabulator-tables';
type GoToRowOptions = { scrollIfVisible: boolean; focusRow: boolean };
export class RowNavigation extends Module {
  static moduleName = 'rowNavigation';
  tableHolder: HTMLElement | null = null;
  private pendingRenderResolvers: Array<() => void> = [];
  private isRenderPending = false;

  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('goToRow', this.goToRow.bind(this));
  }

  initialize(): void {
    this.table.on('renderStarted', () => {
      this.isRenderPending = true;
    });

    this.table.on('renderComplete', () => {
      this.isRenderPending = false;
      const resolvers = this.pendingRenderResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    });
  }

  async goToRow(
    row: RowComponent,
    opts: GoToRowOptions = { scrollIfVisible: true, focusRow: true },
  ): Promise<void> {
    if (!row) {
      return Promise.resolve();
    }

    const { focusRow } = opts;

    const table = this.table;
    this.tableHolder ??= table.element.querySelector('.tabulator-tableholder') as HTMLElement;

    table.blockRedraw();

    const grp = row.getGroup();
    if (grp && !grp.isVisible()) {
      grp.show();
    }

    const rowsToExpand = [];
    //@ts-expect-error This is private to tabulator, but we have no other choice atm.
    let parent = row._getSelf().modules.dataTree ? row.getTreeParent() : false;
    while (parent) {
      if (!parent.isTreeExpanded()) {
        rowsToExpand.push(parent);
      }
      parent = parent.getTreeParent();
    }

    for (const row of rowsToExpand) {
      row.treeExpand();
    }

    for (const row of table.getSelectedRows()) {
      row.deselect();
    }

    row.select();
    table.restoreRedraw();

    if (focusRow) {
      this.tableHolder.focus();
    }

    await this._waitForRenderComplete();
    await this._scrollToRow(row, opts);
  }

  private _waitForRenderComplete(): Promise<void> {
    if (!this.isRenderPending) {
      return this._waitForNextFrame();
    }

    return new Promise<void>((resolve) => {
      this.pendingRenderResolvers.push(resolve);
    });
  }

  private _waitForNextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  async _scrollToRow(row: RowComponent, opts: GoToRowOptions): Promise<void> {
    const { scrollIfVisible, focusRow } = opts;

    await this.table.scrollToRow(row, 'center', scrollIfVisible);

    const elem = row.getElement();

    // STOCK VirtualDomVertical workaround — re-add when switching back to the
    // stock renderer (see module/ScrollAnchor.ts banner for the full recipe).
    // Not needed with the custom VirtualVerticalRenderer: its
    // scrollToRow('center') places correctly (reconcile-based placement +
    // DOM-truth snap), and the patch-up below would fight it by writing
    // paddingBottom/scrollTop directly.
    // if (scrollIfVisible || !this._isVisible(elem)) {
    //   this._centerRow(elem);
    // }

    if (focusRow) {
      elem.focus();
    }
  }

  // STOCK VirtualDomVertical workaround — re-add (with its call in
  // `_scrollToRow`) when switching back to the stock renderer. Not needed
  // with the custom VirtualVerticalRenderer, whose scrollToRow('center')
  // places correctly. TODO: Remove once fixed upstream in tabulator-tables.
  //
  // Tabulator bug: _addBottomRow zeroes vDomBottomPad when vDomBottom reaches the last
  // row index — even for mid-table rows in expanded trees. This shrinks scrollHeight,
  // clamping scrollTop so scrollToRow places the row at the viewport bottom not center.
  // Fix: restore the minimum vDomBottomPad needed for centering, then set scrollTop
  // directly via offsetTop.
  //
  // _isVisible(el: Element) {
  //   if (!this.tableHolder || !el.isConnected) {
  //     return false;
  //   }
  //   const holderRect = this.tableHolder.getBoundingClientRect();
  //   const rect = el.getBoundingClientRect();
  //   return rect.top >= holderRect.top && rect.bottom <= holderRect.bottom;
  // }
  //
  // _centerRow(elem: HTMLElement) {
  //   if (!this.tableHolder) {
  //     return;
  //   }
  //
  //   // Only near-bottom rows have vDomBottomPad forced to 0 — skip the DOM write for
  //   // all other rows where Tabulator already set it correctly.
  //   const renderer = this.table.rowManager?.renderer as Record<string, unknown> | undefined;
  //   if (renderer && this.tableHolder && ((renderer.vDomBottomPad as number) ?? 0) === 0) {
  //     const displayRows: unknown[] = this.table.rowManager?.getDisplayRows?.() ?? [];
  //     const vDomBottom = (renderer.vDomBottom as number) ?? 0;
  //     const vDomRowHeight = (renderer.vDomRowHeight as number) ?? 24;
  //     const truePad = Math.max(0, (displayRows.length - vDomBottom - 1) * vDomRowHeight);
  //     // Cap at clientHeight/2 — the maximum extra scroll range needed to center any row.
  //     // Avoids large paddingBottom values for mid-table rows. If truePad < clientHeight/2
  //     // the row is genuinely near the bottom and the browser clamps naturally — no blank space.
  //     const neededPad = Math.min(truePad, this.tableHolder.clientHeight / 2);
  //     if (neededPad > 0) {
  //       renderer.vDomBottomPad = neededPad;
  //       (renderer.tableElement as HTMLElement).style.paddingBottom = `${neededPad}px`;
  //     }
  //   }
  //
  //   // Reading elem.offsetTop forces a layout flush — paddingBottom is included in
  //   // scrollHeight before scrollTop is assigned.
  //   const holderHeight = this.tableHolder.clientHeight;
  //   this.tableHolder.scrollTop = elem.offsetTop - holderHeight / 2 + elem.offsetHeight / 2;
  // }
}
