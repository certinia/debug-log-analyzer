/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

type FilterRange = { start: number | null; end: number | null };

type RowWithChildren = { _children?: unknown[]; id: number | string };

const NS_PER_MS = 1_000_000;

export default function (filterVal: FilterRange, rowVal: number): boolean {
  if (!('start' in filterVal) || !('end' in filterVal)) {
    return false;
  }
  return inRange(filterVal, rowVal);
}

export const minMaxTreeFilter = (
  filterVal: FilterRange,
  rowVal: number,
  rowData: RowWithChildren,
  filterParams: { columnName: string; filterCache: Map<number | string, boolean> },
): boolean => {
  if (!('start' in filterVal) || !('end' in filterVal)) {
    return false;
  }
  return deepFilter(filterVal, rowVal, rowData, filterParams);
};

function deepFilter(
  headerValue: FilterRange,
  rowValue: number,
  rowData: RowWithChildren,
  filterParams: { columnName: string; filterCache: Map<number | string, boolean> },
): boolean {
  const cached = filterParams.filterCache.get(rowData.id);
  if (cached !== undefined) {
    return cached;
  }

  const { columnName } = filterParams;
  let childMatch = false;
  for (const childRow of (rowData._children ?? []) as RowWithChildren[]) {
    const childVal = getByPath(childRow, columnName);
    if (typeof childVal === 'number' && deepFilter(headerValue, childVal, childRow, filterParams)) {
      childMatch = true;
      break;
    }
  }

  filterParams.filterCache.set(rowData.id, childMatch);
  if (childMatch) {
    return true;
  }

  return inRange(headerValue, rowValue);
}

function inRange(range: FilterRange, value: number): boolean {
  const rowVal = +(value / NS_PER_MS).toFixed(3);
  const { start: min, end: max } = range;
  if (min !== null && max !== null) {
    return rowVal >= min && rowVal <= max;
  }
  if (min !== null) {
    return rowVal >= min;
  }
  if (max !== null) {
    return rowVal <= max;
  }
  return true;
}

function getByPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }
  if (!path.includes('.')) {
    return (obj as Record<string, unknown>)[path];
  }
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
