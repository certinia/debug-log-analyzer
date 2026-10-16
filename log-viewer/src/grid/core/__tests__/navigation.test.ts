/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { GridStore, navigate } from '../index.js';
import { groupOf, rowsOf as settledRows, source } from './fixtures.js';

interface Node {
  key: string;
  kind: string;
  children?: Node[];
}

const n = (key: string, kind: string, ...children: Node[]): Node => ({
  key,
  kind,
  children: children.length ? children : undefined,
});

/** a ─ b ─ c, then d; every row open. Shown: a@0 b@1 c@2 d@0 */
const tree = (): Node[] => [n('a', 'x', n('b', 'x', n('c', 'x'))), n('d', 'y')];

const rowsOf = (options: ConstructorParameters<typeof GridStore<Node>>[1] = {}) =>
  settledRows(new GridStore(source(tree()), { expanded: true, ...options }));

describe('navigate', () => {
  it('moves the selection down and up, and stops at either end', async () => {
    const rows = await rowsOf();
    expect(navigate(rows, 0, 'down')).toEqual({ kind: 'select', index: 1 });
    expect(navigate(rows, 1, 'up')).toEqual({ kind: 'select', index: 0 });
    expect(navigate(rows, 0, 'up')).toBeNull();
    expect(navigate(rows, 3, 'down')).toBeNull();
  });

  it('jumps a page, stopping at either end, or to the first and last row', async () => {
    const rows = await rowsOf();
    expect(navigate(rows, 0, 'pageDown', 2)).toEqual({ kind: 'select', index: 2 });
    expect(navigate(rows, 2, 'pageDown', 5)).toEqual({ kind: 'select', index: 3 });
    expect(navigate(rows, 3, 'pageUp', 2)).toEqual({ kind: 'select', index: 1 });
    expect(navigate(rows, 1, 'pageUp', 5)).toEqual({ kind: 'select', index: 0 });
    expect(navigate(rows, 0, 'pageUp', 2)).toBeNull();
    expect(navigate(rows, 3, 'pageDown', 2)).toBeNull();
    expect(navigate(rows, 2, 'home')).toEqual({ kind: 'select', index: 0 });
    expect(navigate(rows, 0, 'end')).toEqual({ kind: 'select', index: 3 });
  });

  it('opens a closed row, and steps into the first child of an open one', async () => {
    const closed = await rowsOf({ expanded: false });
    expect(navigate(closed, 0, 'right')).toEqual({ kind: 'expand', index: 0 });
    const open = await rowsOf();
    expect(navigate(open, 0, 'right')).toEqual({ kind: 'select', index: 1 });
    expect(navigate(open, 2, 'right')).toBeNull();
  });

  it('closes an open row, and steps out of a closed one to its parent', async () => {
    const rows = await rowsOf();
    expect(navigate(rows, 1, 'left')).toEqual({ kind: 'collapse', index: 1 });
    expect(navigate(rows, 2, 'left')).toEqual({ kind: 'select', index: 1 });
    expect(navigate(rows, 3, 'left')).toBeNull();
  });

  it('treats a group row as the parent of its rows', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    await store.settled();
    await store.toggle(groupOf(store, 'x'));
    const rows = store.snapshot().rows;
    // [x]+ a- [y]-
    expect(navigate(rows, 1, 'left')).toEqual({ kind: 'select', index: 0 });
    expect(navigate(rows, 0, 'left')).toEqual({ kind: 'collapse', index: 0 });
    expect(navigate(rows, 2, 'right')).toEqual({ kind: 'expand', index: 2 });
  });

  it('does nothing with no row selected', async () => {
    const rows = await rowsOf();
    expect(navigate(rows, -1, 'down')).toBeNull();
  });
});
