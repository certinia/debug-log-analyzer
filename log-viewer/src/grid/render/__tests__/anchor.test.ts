/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  Group,
  GridStore,
  sortComparator,
  type RowView,
  type TreeSource,
} from '../../core/index.js';
import { capture, restore, type ShownRow } from '../anchor.js';

interface Node {
  key: string;
  v: number;
  kind: string;
  children?: Node[];
}

const n = (key: string, v: number, kind: string, ...children: Node[]): Node => ({
  key,
  v,
  kind,
  children: children.length ? children : undefined,
});

/** Ten roots r0..r9; r5 holds c0..c2. */
const tree = (): Node[] =>
  Array.from({ length: 10 }, (_, i) =>
    i === 5
      ? n(`r${i}`, i, i % 2 ? 'odd' : 'even', n('c0', 0, 'x'), n('c1', 1, 'x'), n('c2', 2, 'x'))
      : n(`r${i}`, i, i % 2 ? 'odd' : 'even'),
  );

const source = (roots: Node[]): TreeSource<Node> => ({
  roots,
  children: (row) => row.children,
  key: (row) => row.key,
});

const ROW = 20;

/** Rows `from`..`to` on screen, each ROW high, the first `scrolled` px above the viewport. */
const shownRows = (from: number, to: number, scrolled = 0): ShownRow[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    index: from + i,
    top: i * ROW - scrolled,
    height: ROW,
  }));

const viewport = (scrollTop: number, maxScrollTop = 1000, height = 100) => ({
  scrollTop,
  maxScrollTop,
  height,
});

async function rowsOf(store: GridStore<Node>): Promise<RowView<Node>> {
  await store.settled();
  return store.snapshot().rows;
}

describe('anchoring', () => {
  it('sort or filter: keeps the middle row at its place', async () => {
    const store = new GridStore(source(tree()));
    const before = await rowsOf(store);
    // r2..r6 on screen; the middle (50px) is r4.
    const cap = capture(viewport(200), shownRows(2, 6), before);
    await store.setSort(sortComparator<Node>({ value: (r) => r.v }, 'desc'));
    const after = store.snapshot().rows;
    expect(restore(cap, after)).toEqual({ index: after.indexOf('r4'), top: 40 });
  });

  it('toggle: puts the toggled row back where it was, not the middle row', async () => {
    const store = new GridStore(source(tree()));
    const before = await rowsOf(store);
    const cap = capture(viewport(200), shownRows(3, 7), before);
    await store.toggle('r5');
    const after = store.snapshot().rows;
    expect(restore(cap, after, 'r5')).toEqual({ index: 5, top: 40 });
    expect(restore(cap, after, 'r6')).toEqual({ index: 9, top: 60 });
  });

  it('at the top: stays at the top, toggle or not', async () => {
    const rows = await rowsOf(new GridStore(source(tree())));
    const cap = capture(viewport(4), shownRows(0, 4), rows);
    expect(restore(cap, rows)).toEqual({ edge: 'top' });
    expect(restore(cap, rows, 'r2')).toEqual({ edge: 'top' });
  });

  it('at the bottom: stays at the bottom, toggle or not', async () => {
    const rows = await rowsOf(new GridStore(source(tree())));
    const cap = capture(viewport(995), shownRows(5, 9), rows);
    expect(restore(cap, rows)).toEqual({ edge: 'bottom' });
    expect(restore(cap, rows, 'r7')).toEqual({ edge: 'bottom' });
  });

  it('a tiny overflow: a user at the bottom stays at the bottom, not the top', async () => {
    const rows = await rowsOf(new GridStore(source(tree())));
    // Near both edges; 3px from the bottom against 6px from the top.
    expect(capture(viewport(6, 9), shownRows(0, 4), rows).edge).toBe('bottom');
    expect(capture(viewport(3, 9), shownRows(0, 4), rows).edge).toBe('top');
  });

  it('a middle row filtered out: its nearest shown ancestor takes its place', async () => {
    const store = new GridStore(source(tree()), { expanded: true });
    const before = await rowsOf(store);
    // r4 r5 c0 c1 c2 r6 at 0, 20, 40...: c0 spans the middle (50px).
    const cap = capture(viewport(200), shownRows(4, 9), before);
    expect(before.keyAt(6)).toBe('c0');
    await store.setFilters([{ test: (r) => r.kind !== 'x' }]);
    const after = store.snapshot().rows;
    expect(restore(cap, after)).toEqual({ index: after.indexOf('r5'), top: 40 });
  });

  it('a middle row gone with no ancestor left: leaves the position alone', async () => {
    const store = new GridStore(source(tree()));
    const before = await rowsOf(store);
    const cap = capture(viewport(200), shownRows(2, 6), before);
    await store.setFilters([{ test: (r) => r.key !== 'r4' }]);
    expect(restore(cap, store.snapshot().rows)).toBeNull();
  });

  it('a toggled row that was off screen: falls back to the middle row', async () => {
    const store = new GridStore(source(tree()));
    const before = await rowsOf(store);
    const cap = capture(viewport(200), shownRows(0, 3), before);
    await store.toggle('r5');
    const after = store.snapshot().rows;
    expect(restore(cap, after, 'r5')).toEqual({ index: after.indexOf('r2'), top: 40 });
  });

  it('a row in a group: its group takes its place when the group closes', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    const even = (await rowsOf(store)).rowAt(0);
    if (!(even instanceof Group)) {
      throw new Error('not grouped');
    }
    await store.toggle(even);
    // [even]+ r0 r2 r4 r6 r8 [odd]-: from index 2, r6 spans the middle.
    const rows = store.snapshot().rows;
    const cap = capture(viewport(200), shownRows(2, 6), rows);
    expect(rows.keyAt(4)).toBe('r6');
    await store.toggle(even);
    expect(restore(cap, store.snapshot().rows)).toEqual({ index: 0, top: 40 });
  });
});
