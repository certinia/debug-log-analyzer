/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { storeOf } from '#test-helpers/apexLog.js';
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

describe('MergedTree.bottomUp', () => {
  const LOG =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (2000)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
    '09:18:22.6 (3000)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
    '09:18:22.6 (4000)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  // The Call Tree and Analysis each built a copy, so a log open in both held its rows twice.
  it('hands every caller of one store the same tree', async () => {
    const { store } = await storeOf(LOG);

    const [first, second] = await Promise.all([
      MergedTree.bottomUp(store),
      MergedTree.bottomUp(store),
    ]);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  // A view that stops waiting must not take the tree away from one still waiting.
  it('answers an aborted caller with nothing, and still builds for the rest', async () => {
    const { store } = await storeOf(LOG);
    const stop = new AbortController();

    const aborted = MergedTree.bottomUp(store, { signal: stop.signal });
    const waiting = MergedTree.bottomUp(store);
    stop.abort();

    expect(await aborted).toBeNull();
    expect((await waiting)?.source.roots.map((row) => row.text)).toEqual(
      expect.arrayContaining(['ns.Inner.go()', 'ns.Outer.run()']),
    );
  });

  // The failure belongs to the views still waiting, not to one that left for another log.
  it('keeps a failed build from an aborted caller, and builds again for the next', async () => {
    const { store } = await storeOf(LOG);
    const index = jest.spyOn(store, 'logIndex').mockRejectedValue(new Error('boom'));
    const stop = new AbortController();

    const aborted = MergedTree.bottomUp(store, { signal: stop.signal });
    const waiting = MergedTree.bottomUp(store);
    stop.abort();

    expect(await aborted).toBeNull();
    await expect(waiting).rejects.toThrow('boom');
    index.mockRestore();
    expect(await MergedTree.bottomUp(store)).not.toBeNull();
  });
});
