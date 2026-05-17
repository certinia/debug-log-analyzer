/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { RowComponent } from 'tabulator-tables';

type TabulatorFilterRow<T> = (row: { getData(): T }, filters?: unknown) => boolean;

type InternalRow<T> = { getData(): T };

type TableRow<T> = RowComponent | InternalRow<T> | T;

export interface DataTreeFilterTable<T extends object> {
  getRows(rowRange?: string): TableRow<T>[];
  modules?: {
    filter?: {
      filterRow: TabulatorFilterRow<T>;
    };
  };
  options?: {
    dataTreeChildField?: string;
    dataTreeFilter?: boolean;
  };
}

function getChildren<T extends object>(row: T, childField: string): T[] {
  const childRows = (row as Record<string, unknown>)[childField];
  return Array.isArray(childRows) ? (childRows as T[]) : [];
}

function toDataRow<T extends object>(row: TableRow<T>): T {
  if (typeof row !== 'object' || row === null) {
    return row as T;
  }

  if ('getData' in row && typeof row.getData === 'function') {
    return row.getData() as T;
  }

  if ('_getSelf' in row) {
    return (row as { _getSelf(): InternalRow<T> })._getSelf().getData();
  }

  return row as T;
}

export function getFilteredDataTreeRows<T extends object>(table: DataTreeFilterTable<T>): T[] {
  const anchors = (table.getRows('active') as readonly TableRow<T>[]).map((row) => toDataRow(row));
  const childField = table.options?.dataTreeChildField ?? '_children';
  const filterModule = table.modules?.filter;
  const shouldApplyFilter = table.options?.dataTreeFilter !== false && !!filterModule;

  const rowShim: { _data: T | null; getData(): T } = {
    _data: null,
    getData() {
      return this._data as T;
    },
  };
  const passesFilter = shouldApplyFilter
    ? (row: T): boolean => {
        rowShim._data = row;
        return filterModule!.filterRow(rowShim);
      }
    : (_row: T): boolean => true;

  const output: T[] = [];

  const walk = (row: T): void => {
    if (!passesFilter(row)) {
      return;
    }
    output.push(row);
    for (const child of getChildren(row, childField)) {
      walk(child);
    }
  };

  for (const anchor of anchors) {
    walk(anchor);
  }

  return output;
}
