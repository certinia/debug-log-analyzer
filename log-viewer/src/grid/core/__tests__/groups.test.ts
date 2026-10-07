/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  Group,
  GridStore,
  max,
  sortComparator,
  sum,
  type RowView,
  type TreeSource,
} from '../index.js';

interface Node {
  key: string;
  kind: string;
  self: number;
  children?: Node[];
}

const n = (key: string, kind: string, self: number, ...children: Node[]): Node => ({
  key,
  kind,
  self,
  children: children.length ? children : undefined,
});

/**
 *   a  apex 10     d  soql 20     f  apex 1
 *   ├ b dml 40     └ e dml 10
 *   └ c apex 5
 */
const tree = (): Node[] => [
  n('a', 'apex', 10, n('b', 'dml', 40), n('c', 'apex', 5)),
  n('d', 'soql', 20, n('e', 'dml', 10)),
  n('f', 'apex', 1),
];

const source = (roots: Node[]): TreeSource<Node> => ({
  roots,
  children: (row) => row.children,
  key: (row) => row.key,
});

const byKind = (row: Node): string => row.kind;
const self = (row: Node): number => row.self;

/** `[group]` for a group row, `key@depth` for a data row; `+`/`-` mark open and closed. */
function shown(rows: RowView<Node>): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.size; i++) {
    const entry = rows.rowAt(i);
    const mark = rows.hasChildrenAt(i) ? (rows.isExpandedAt(i) ? '+' : '-') : '';
    out.push(
      entry instanceof Group ? `[${entry.key}]${mark}` : `${entry.key}${mark}@${rows.depthAt(i)}`,
    );
  }
  return out;
}

const groupOf = (store: GridStore<Node>, key: string): Group<Node> => {
  const rows = store.snapshot().rows;
  for (let i = 0; i < rows.size; i++) {
    const entry = rows.rowAt(i);
    if (entry instanceof Group && entry.key === key) {
      return entry;
    }
  }
  throw new Error(`no group ${key}`);
};

describe('GridStore groups', () => {
  it('starts every group closed, most rows first, then by key', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.settled();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]-']);
  });

  it('opens a group to show its rows one level in, with their own tree', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.settled();
    await store.toggle(groupOf(store, 'apex'));
    await store.toggle('a');
    expect(shown(store.snapshot().rows)).toEqual([
      '[apex]+',
      'a+@1',
      'b@2',
      'c@2',
      'f@1',
      '[soql]-',
    ]);
    await store.toggle(groupOf(store, 'apex'));
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]-']);
  });

  it('leaves groups as they are on expand all and collapse all', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.settled();
    await store.toggle(groupOf(store, 'soql'));
    await store.expandAll();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]+', 'd+@1', 'e@2']);
    await store.collapseAll();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]+', 'd-@1']);
  });

  it('drops a group when the filters leave it empty', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.setFilters([{ test: (r) => r.kind !== 'soql' }]);
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-']);
  });

  it('sorts the rows in a group, and the groups by their totals', async () => {
    const store = new GridStore(source(tree()), {
      groupBy: byKind,
      calcs: { self: sum(self) },
    });
    await store.settled();
    await store.toggle(groupOf(store, 'apex'));
    await store.setSort(
      sortComparator<Node>({ value: self }, 'asc'),
      sortComparator<Group<Node>>({ value: (g) => g.totals.self }, 'desc'),
    );
    // soql totals 20, apex 11.
    expect(shown(store.snapshot().rows)).toEqual(['[soql]-', '[apex]+', 'f@1', 'a-@1']);
  });

  it('keeps the default order for groups whose totals tie', async () => {
    const roots = [n('p', 'x', 1), n('q', 'y', 1), n('r', 'y', 0)];
    const store = new GridStore(source(roots), { groupBy: byKind, calcs: { self: sum(self) } });
    await store.setSort(null, sortComparator<Group<Node>>({ value: (g) => g.totals.self }, 'asc'));
    expect(shown(store.snapshot().rows)).toEqual(['[y]-', '[x]-']);
  });

  it('opens the group a revealed row is in', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    expect(await store.reveal(['a', 'c'])).toBe(3);
    expect(shown(store.snapshot().rows)).toEqual([
      '[apex]+',
      'a+@1',
      'b@2',
      'c@2',
      'f@1',
      '[soql]-',
    ]);
  });

  it('ungroups', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.setGroupBy(null);
    expect(shown(store.snapshot().rows)).toEqual(['a-@0', 'd-@0', 'f@0']);
  });
});

describe('GridStore totals', () => {
  it('totals the top-level rows that pass the filters, for the footer and each group', async () => {
    const store = new GridStore(source(tree()), {
      groupBy: byKind,
      calcs: { self: sum(self), most: max(self) },
    });
    await store.settled();
    expect(store.snapshot().totals).toEqual({ self: 31, most: 20 });
    expect(groupOf(store, 'apex').totals).toEqual({ self: 11, most: 10 });
    await store.setFilters([{ test: (r) => r.key !== 'd' }]);
    expect(store.snapshot().totals).toEqual({ self: 11, most: 10 });
  });

  it('totals every row that passes the filters at any depth, open or not', async () => {
    const store = new GridStore(source(tree()), { calcs: { self: sum(self, 'all') } });
    await store.settled();
    expect(store.snapshot().totals.self).toBe(10 + 40 + 5 + 20 + 10 + 1);
    await store.setFilters([{ test: (r) => r.key !== 'b' }]);
    expect(store.snapshot().totals.self).toBe(10 + 5 + 20 + 10 + 1);
  });

  it('keeps totals across sort and expansion', async () => {
    let runs = 0;
    const counted = {
      of: (rows: readonly Node[]): number => {
        runs++;
        return rows.length;
      },
    };
    const store = new GridStore(source(tree()), { groupBy: byKind, calcs: { count: counted } });
    await store.settled();
    const before = runs;
    await store.setSort(sortComparator<Node>({ value: self }, 'desc'));
    await store.toggle(groupOf(store, 'apex'));
    await store.expandAll();
    expect(runs).toBe(before);
    await store.setFilters([]);
    expect(runs).toBeGreaterThan(before);
  });

  it('runs a calc that yields in slices, for the footer and each group', async () => {
    let yields = 0;
    const sliced = {
      *of(rows: readonly Node[]): Generator<void, number, void> {
        let total = 0;
        for (const row of rows) {
          total += row.self;
          yields++;
          yield;
        }
        return total;
      },
    };
    let t = 0;
    const store = new GridStore(source(tree()), {
      groupBy: byKind,
      calcs: { self: sliced },
      scheduler: { now: () => (t += 100), yield: () => new Promise((r) => setTimeout(r, 0)) },
    });
    await store.settled();
    expect(store.snapshot().totals.self).toBe(31);
    expect(groupOf(store, 'soql').totals.self).toBe(20);
    expect(yields).toBe(6);
  });

  it('gives a max of 0 for no rows', () => {
    expect(max(self).of([])).toBe(0);
  });
});
