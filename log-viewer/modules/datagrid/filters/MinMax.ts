/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

export default function (
  filterVal: { start: number | null; end: number | null },
  rowVal: number,
  rowData: { _children: []; id: number },
  filterParams: { columnName: string; filterCache: Map<number, boolean> },
): boolean {
  if (!('start' in filterVal) || !('end' in filterVal)) {
    return false;
  }

  return deepFilter(filterVal, rowVal, rowData, filterParams);
}

function deepFilter(
  headerValue: { start: number | null; end: number | null },
  rowValue: number,
  rowData: { _children: []; id: number },
  filterParams: { columnName: string; filterCache: Map<number, boolean> },
): boolean {
  const cachedMatch = filterParams.filterCache.get(rowData.id);
  if (cachedMatch !== null && cachedMatch !== undefined) {
    return cachedMatch;
  }

  const columnName = filterParams.columnName;
  let childMatch = false;
  for (const childRow of rowData._children || []) {
    const match = deepFilter(headerValue, childRow[columnName], childRow, filterParams);

    if (match) {
      childMatch = true;
      break;
    }
  }

  filterParams.filterCache.set(rowData.id, childMatch);
  if (childMatch) {
    return true;
  }

  const rowVal = +(rowValue / 1000000).toFixed(3);
  const min = headerValue.start;
  const max = headerValue.end;
  if (min && max) {
    return rowVal >= min && rowVal <= max;
  } else if (min) {
    return rowVal >= min;
  } else if (max) {
    return rowVal <= max;
  }

  return true;
}
