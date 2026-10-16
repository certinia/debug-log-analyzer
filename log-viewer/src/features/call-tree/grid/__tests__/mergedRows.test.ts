/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { MergedTree } from '../mergedRows.js';

interface Row {
  id: number;
  _pathId: number;
  _children?: Row[] | null;
}

// Bucket A holds caller B; bucket B stands alone. Path ids differ from row ids on purpose.
const callerB: Row = { id: 2, _pathId: 20 };
const bucketA: Row = { id: 1, _pathId: 10, _children: [callerB] };
const bucketB: Row = { id: 3, _pathId: 30 };
const tree = new MergedTree([bucketA, bucketB]);

describe('MergedTree.rowFor', () => {
  it('picks the top-level row, wherever it comes in the path ids', () => {
    expect(tree.rowFor([20, 30])).toBe(bucketB);
  });

  it('falls back to the first row named when none is top-level', () => {
    expect(tree.rowFor([99, 20])).toBe(callerB);
  });

  it('names nothing without ids', () => {
    expect(tree.rowFor([])).toBeUndefined();
  });
});

describe('MergedTree.pathTo', () => {
  it('runs from the top-level row down to the row named', () => {
    expect(tree.pathTo([20])).toEqual([1, 2]);
  });
});

describe('MergedTree.marked', () => {
  it('keys every row the path ids name, and skips unknown ids', () => {
    expect(tree.marked([20, 30, 99])).toEqual(new Set([2, 3]));
  });
});
