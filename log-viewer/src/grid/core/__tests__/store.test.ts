/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  GridStore,
  sortComparator,
  sum,
  type RowView,
  type Scheduler,
  type TreeSource,
} from '../index.js';

interface Node {
  key: string;
  value: number;
  children?: Node[];
}

const n = (key: string, value: number, ...children: Node[]): Node => ({
  key,
  value,
  children: children.length ? children : undefined,
});

/**
 *   a(3)          d(1)
 *   ├ b(2)        └ e(9)
 *   │ └ c(1)
 *   └ x(5)
 */
const tree = (): Node[] => [n('a', 3, n('b', 2, n('c', 1)), n('x', 5)), n('d', 1, n('e', 9))];

const source = (roots: Node[]): TreeSource<Node> => ({
  roots,
  children: (row) => row.children,
  key: (row) => row.key,
});

/** `key@depth` for each row, with `+` for expanded and `-` for collapsed parents. */
function shown(rows: RowView<Node>): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.size; i++) {
    const mark = rows.hasChildrenAt(i) ? (rows.isExpandedAt(i) ? '+' : '-') : '';
    out.push(`${rows.keyAt(i)}${mark}@${rows.depthAt(i)}`);
  }
  return out;
}

async function ready(store: GridStore<Node>): Promise<string[]> {
  await store.settled();
  return shown(store.snapshot().rows);
}

/** Yields on every check, so each sliced step takes many turns of the event loop. */
const everyCheck = (): Scheduler => {
  let t = 0;
  return { now: () => (t += 100), yield: () => new Promise((r) => setTimeout(r, 0)) };
};

describe('GridStore', () => {
  it('shows only the roots of a tree at first', async () => {
    expect(await ready(new GridStore(source(tree())))).toEqual(['a-@0', 'd-@0']);
  });

  it('shows a flat list as it is', async () => {
    const flat: TreeSource<Node> = { roots: [n('p', 1), n('q', 2)], key: (r) => r.key };
    expect(await ready(new GridStore(flat))).toEqual(['p@0', 'q@0']);
  });

  it('starts expanded where the policy says so', async () => {
    const store = new GridStore(source(tree()), { expanded: (_row, depth) => depth === 0 });
    expect(await ready(store)).toEqual(['a+@0', 'b-@1', 'x@1', 'd+@0', 'e@1']);
  });

  it('expands and collapses every row', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd+@0', 'e@1']);
    await store.collapseAll();
    expect(shown(store.snapshot().rows)).toEqual(['a-@0', 'd-@0']);
  });

  it('splices one row open and closed, and keeps what was open beneath it', async () => {
    const store = new GridStore(source(tree()));
    await store.settled();
    await store.toggle('a');
    await store.toggle('b');
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd-@0']);
    await store.toggle('a');
    expect(shown(store.snapshot().rows)).toEqual(['a-@0', 'd-@0']);
    await store.toggle('a', true);
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd-@0']);
  });

  it('leaves a row alone when it is not shown, has no children or is already in that state', async () => {
    const store = new GridStore(source(tree()));
    await store.settled();
    const before = store.snapshot().version;
    await store.toggle('c');
    await store.toggle('missing');
    await store.toggle('a', false);
    expect(store.snapshot().version).toBe(before);
  });

  it('sorts each sibling list and keeps expansion', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();
    await store.setSort(sortComparator<Node>({ value: (r) => r.value }, 'desc'));
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'x@1', 'b+@1', 'c@2', 'd+@0', 'e@1']);
    await store.setSort(null);
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd+@0', 'e@1']);
  });

  it('filters each level, hiding a failed row with its subtree', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();
    await store.setFilters([{ test: (r) => r.key !== 'b' && r.key !== 'e' }]);
    // d keeps no child, so it is no longer a parent.
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'x@1', 'd@0']);
  });

  it('keeps the ancestors of a match when the filter asks for it', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();
    await store.setFilters([{ test: (r) => r.key === 'c', keepAncestors: true }]);
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2']);
  });

  it('shows a row only when every filter passes it', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();
    await store.setFilters([
      { test: (r) => r.value < 9, keepAncestors: true },
      { test: (r) => r.key !== 'x' },
    ]);
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'd@0']);
  });

  it('runs a filter again on refresh, and keeps open rows open', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();
    let hidden = 'c';
    await store.setFilters([{ test: (r) => r.key !== hidden, keepAncestors: true }]);
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b@1', 'x@1', 'd+@0', 'e@1']);

    hidden = 'e';
    await store.refresh();
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd@0']);
  });

  it('sums the calcs again on refresh', async () => {
    let scale = 1;
    const store = new GridStore(source(tree()), {
      calcs: { total: sum((r: Node) => r.value * scale) },
    });
    await store.settled();
    expect(store.snapshot().totals.total).toBe(4);

    scale = 10;
    const rows = store.snapshot().rows;
    await store.refresh();
    expect(store.snapshot().totals.total).toBe(40);
    // No filter is on, so the rows on screen stay as they are.
    expect(store.snapshot().rows).toBe(rows);
  });

  it('reveals a deep row by expanding its ancestors', async () => {
    const store = new GridStore(source(tree()));
    expect(await store.reveal(['a', 'b', 'c'])).toBe(2);
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd-@0']);
  });

  it('reveals the deepest shown row when a filter hides the rest of the path', async () => {
    const store = new GridStore(source(tree()));
    await store.setFilters([{ test: (r) => r.key !== 'c' }]);
    expect(await store.reveal(['a', 'b', 'c'])).toBe(1);
    expect(await store.reveal(['zz'])).toBe(-1);
  });

  it('reveals a row on an open path without building the rows again', async () => {
    const store = new GridStore(source(tree()));
    await store.reveal(['a', 'b', 'c']);
    const rows = store.snapshot().rows;
    expect(await store.reveal(['a', 'x'])).toBe(3);
    expect(store.snapshot().rows).toBe(rows);
  });

  it('gives the error a step throws to its callers, then stays usable', async () => {
    const store = new GridStore(source(tree()));
    await store.settled();
    const boom = new Error('boom');
    const failing = store.setFilters([
      {
        test: () => {
          throw boom;
        },
      },
    ]);
    const waiting = store.settled();
    await expect(failing).rejects.toBe(boom);
    await expect(waiting).rejects.toBe(boom);
    expect(store.snapshot().busy).toBe(false);
    await store.setFilters([]);
    await store.expandAll();
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd+@0', 'e@1']);
  });

  it('builds a change that came while a step threw, and gives no one the replaced error', async () => {
    const store = new GridStore(source(tree()));
    await store.settled();
    let newer: Promise<void> | null = null;
    const failing = store.setFilters([
      {
        test: () => {
          newer ??= store.setFilters([]);
          throw new Error('boom');
        },
      },
    ]);
    await expect(failing).resolves.toBeUndefined();
    await expect(newer).resolves.toBeUndefined();
    await store.expandAll();
    expect(shown(store.snapshot().rows)).toEqual(['a+@0', 'b+@1', 'c@2', 'x@1', 'd+@0', 'e@1']);
  });

  it('gives the same rows when every step is sliced', async () => {
    const store = new GridStore(source(tree()), { scheduler: everyCheck() });
    await store.expandAll();
    await store.setSort(sortComparator<Node>({ value: (r) => r.value }, 'asc'));
    expect(shown(store.snapshot().rows)).toEqual(['d+@0', 'e@1', 'a+@0', 'b+@1', 'c@2', 'x@1']);
  });

  it('lets the newest change win while a step runs, and resolves every caller', async () => {
    const roots = Array.from({ length: 2000 }, (_, i) => n(`r${i}`, i, n(`c${i}`, i)));
    const store = new GridStore(source(roots), { scheduler: everyCheck() });
    await store.settled();
    const expanding = store.expandAll();
    const collapsing = store.collapseAll();
    await Promise.all([expanding, collapsing]);
    expect(store.snapshot().rows.size).toBe(2000);
    expect(store.snapshot().busy).toBe(false);
  });

  it('tells subscribers about each new snapshot', async () => {
    const store = new GridStore(source(tree()));
    await store.settled();
    const versions: number[] = [];
    const stop = store.subscribe((s) => versions.push(s.version));
    await store.expandAll();
    stop();
    await store.collapseAll();
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(store.snapshot().version).toBeGreaterThan(versions.at(-1) ?? 0);
  });
});

describe('sortComparator', () => {
  const rows = (...values: (number | null)[]): { v: number | null }[] => values.map((v) => ({ v }));
  const order = (dir: 'asc' | 'desc'): (number | null)[] =>
    rows(2, null, 3, 1, null)
      .sort(sortComparator<{ v: number | null }>({ value: (r) => r.v }, dir))
      .map((r) => r.v);

  it('puts empty values last in both directions', () => {
    expect(order('asc')).toEqual([1, 2, 3, null, null]);
    expect(order('desc')).toEqual([3, 2, 1, null, null]);
  });

  it('compares text naturally, numbers in text included', () => {
    const names = ['item10', 'Item2', 'item1'].map((v) => ({ v }));
    names.sort(sortComparator<{ v: string }>({ value: (r) => r.v }, 'asc'));
    expect(names.map((r) => r.v)).toEqual(['item1', 'Item2', 'item10']);
  });

  it('reverses a custom compare for descending', () => {
    const custom = sortComparator<number>({ compare: (a, b) => a - b }, 'desc');
    expect([1, 3, 2].sort(custom)).toEqual([3, 2, 1]);
  });
});
