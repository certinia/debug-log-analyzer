/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';
import type { TimedNode } from '../../../parsers/ApexLogParser';

type TimedNodeProp = { originalData: TimedNode };

const middleRowFocusOption = 'middleRowFocus' as const;
/**
 * Enable MiddleRowFocus by importing the class and calling
 * Tabulator.registerModule(MiddleRowFocus); before the first instantiation of the table.
 * Then enable by setting middleRowFocus to true in table config.
 * To disable RowNavigation set middleRowFocus to false in table options.
 */
export class MiddleRowFocus extends Module {
  static moduleName = 'middleRowFocus';

  middleRow: RowComponent | null = null;
  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption(middleRowFocusOption, false);
  }

  initialize() {
    // @ts-expect-error not in types
    if (this.options(middleRowFocusOption)) {
      this.table.on('dataTreeRowExpanded', () => {
        this._clearFocusRow();
      });

      this.table.on('dataTreeRowCollapsed', () => {
        this._clearFocusRow();
      });

      this.table.on('renderStarted', () => {
        if (this.table && !this.middleRow) {
          this.middleRow = this._findMiddleVisibleRow(this.table);
        }
      });

      this.table.on('renderComplete', async () => {
        const rowToScrollTo = this.middleRow;
        this._scrollToRow(rowToScrollTo);
        this.middleRow = null;
      });
    }
  }

  private _clearFocusRow() {
    this.middleRow = null;
  }

  private _scrollToRow(row: RowComponent | null) {
    if (!row) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      let rowToScrollTo: RowComponent | null = row;
      if (rowToScrollTo) {
        //@ts-expect-error This is private to tabulator, but we have no other choice atm.
        const internalRow = rowToScrollTo._getSelf();
        const displayRows = internalRow.table.rowManager.getDisplayRows();
        const canScroll = displayRows.indexOf(internalRow) !== -1;
        if (!canScroll) {
          const rowData = rowToScrollTo.getData() as TimedNodeProp;
          const node = rowData.originalData;

          rowToScrollTo = this._findClosestActive(this.table.getRows('active'), node.timestamp);
        }

        if (rowToScrollTo) {
          this.table.scrollToRow(rowToScrollTo, 'center', true).then(() => {
            if (rowToScrollTo) {
              rowToScrollTo
                ?.getElement()
                .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
            }
          });
        }
      }

      window.clearTimeout(timeoutId);
    });
  }

  private _findClosestActive(rows: RowComponent[], timeStamp: number): RowComponent | null {
    if (!rows) {
      return null;
    }

    let start = 0,
      end = rows.length - 1;

    // Iterate as long as the beginning does not encounter the end.
    while (start <= end) {
      // find out the middle index
      const mid = Math.floor((start + end) / 2);
      const row = rows[mid];

      if (!row) {
        break;
      }
      const node = (row.getData() as TimedNodeProp).originalData;

      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = row._getSelf();
      const displayRows = internalRow.table.rowManager.getDisplayRows();
      const endTime = node.exitStamp ?? node.timestamp;

      if (timeStamp === node.timestamp) {
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

  private _findMiddleVisibleRow(table: Tabulator) {
    const visibleRows = table.getRows('visible');
    if (visibleRows.length === 1) {
      return visibleRows[0] || null;
    }

    const tableRect = table.element.getBoundingClientRect();
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
