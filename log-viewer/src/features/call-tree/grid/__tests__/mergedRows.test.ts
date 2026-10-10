/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { linkRows, markedIds, mergedPath, mergedRow } from '../mergedRows.js';

interface Row {
  id: number;
  _pathId: number;
  _children?: Row[] | null;
}

// Bucket A holds caller B; bucket B stands alone. Path ids differ from row ids on purpose.
const callerB: Row = { id: 2, _pathId: 20 };
const bucketA: Row = { id: 1, _pathId: 10, _children: [callerB] };
const bucketB: Row = { id: 3, _pathId: 30 };
const links = linkRows([bucketA, bucketB]);

describe('mergedRow', () => {
  it('picks the top-level row, wherever it comes in the path ids', () => {
    expect(mergedRow(links, [20, 30])).toBe(bucketB);
  });

  it('falls back to the first row named when none is top-level', () => {
    expect(mergedRow(links, [99, 20])).toBe(callerB);
  });

  it('names nothing without links or ids', () => {
    expect(mergedRow(null, [10])).toBeUndefined();
    expect(mergedRow(links, [])).toBeUndefined();
  });
});

describe('mergedPath', () => {
  it('runs from the top-level row down to the row named', () => {
    expect(mergedPath(links, [20])).toEqual([1, 2]);
    expect(mergedPath(links, [20, 30])).toEqual([3]);
  });
});

describe('markedIds', () => {
  it('keys every row the path ids name, and skips unknown ids', () => {
    expect(markedIds(links, [20, 30, 99])).toEqual(new Set([2, 3]));
  });
});
