/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ROOT_PATH_ID } from '#core/log/keyPathIds.js';
import { storeOf } from '#test-helpers/apexLog.js';
import { MergedTree } from '../mergedRows.js';

interface Row {
  id: number;
  _pathId: number;
  _parent?: Row | null;
  _nextOfKey?: Row | null;
  _children?: Row[] | null;
}

// Bucket A holds caller B; bucket B stands alone. Path ids differ from row ids on purpose.
const bucketA: Row = { id: 1, _pathId: 10 };
const callerB: Row = { id: 2, _pathId: 20, _parent: bucketA };
bucketA._children = [callerB];
const bucketB: Row = { id: 3, _pathId: 30 };
callerB._nextOfKey = bucketB;
// Paths 20 and 30 end in B's key (2), path 10 in A's (1); 99 is a path no row stands for.
const KEY_OF_PATH = new Map([
  [10, 1],
  [20, 2],
  [30, 2],
]);
const tree = new MergedTree(
  [bucketA, bucketB],
  {
    keyIdOfPath: (pathId: number) => KEY_OF_PATH.get(pathId) ?? -1,
    // Path 20 extends 10; every other path is top-level.
    parentOf: (pathId: number) => (pathId === 20 ? 10 : ROOT_PATH_ID),
  },
  new Map([
    [1, { first: bucketA }],
    [2, { first: callerB }],
  ]),
);

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

  // A frame can name rows of several keys; reading only the first key's rows would drop the rest.
  it('keys the rows of every key the path ids end in', () => {
    expect(tree.marked([10, 30])).toEqual(new Set([1, 3]));
  });

  // A pointer-leave marks the same pick again; a new pick must not get the last one's marks.
  it('answers a repeated pick at once, and a new pick afresh', () => {
    const pick = [20];

    expect(tree.marked(pick)).toBe(tree.marked(pick));
    expect(tree.marked([30])).toEqual(new Set([3]));
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

  // The build, not a walk after it, links each row to its parent; a row it missed reads as top-level.
  it('finds a caller by path and runs back up to its bucket', async () => {
    const { store } = await storeOf(LOG);
    const tree = await MergedTree.bottomUp(store);
    const bucket = tree?.source.roots.find((row) => row.text === 'ns.Inner.go()');
    const caller = bucket?._children?.find((row) => row.text === 'ns.Outer.run()');

    expect(caller).toBeDefined();
    expect(caller && tree?.parentOf(caller)).toBe(bucket);
    expect(tree?.rowFor([caller?._pathId ?? -1])).toBe(caller);
    expect(tree?.pathTo([caller?._pathId ?? -1])).toEqual([bucket?.id, caller?.id]);
  });
});

describe('MergedTree.aggregated', () => {
  const LOG =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (2000)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
    '09:18:22.6 (3000)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
    '09:18:22.6 (4000)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  it('finds a callee by path and runs back up to its caller', async () => {
    const { store } = await storeOf(LOG);
    const tree = await MergedTree.aggregated(store);
    // `storeOf` wraps the lines in an execution and a code unit: the methods sit two levels down.
    const [execution] = tree?.source.roots ?? [];
    const unit = execution?._children?.[0];
    const outer = unit?._children?.find((row) => row.text === 'ns.Outer.run()');
    const inner = outer?._children?.find((row) => row.text === 'ns.Inner.go()');

    expect(inner).toBeDefined();
    expect(inner && tree?.parentOf(inner)).toBe(outer);
    expect(tree?.marked([inner?._pathId ?? -1])).toEqual(new Set([inner?.id]));
    expect(tree?.pathTo([inner?._pathId ?? -1])).toEqual([
      execution?.id,
      unit?.id,
      outer?.id,
      inner?.id,
    ]);
  });

  // An id the log never minted has no key; reading one as a real key would name some other row.
  it('names no row for a path id the log never minted', async () => {
    const { store } = await storeOf(LOG);
    const tree = await MergedTree.aggregated(store);

    expect(tree?.rowFor([1_000_000])).toBeUndefined();
  });
});
