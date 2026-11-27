/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { GridStore, max, sum } from '../index.js';
import { groupOf, shown, slowScheduler, source } from './fixtures.js';

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

const byKind = (row: Node): string => row.kind;
const self = (row: Node): number => row.self;

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

  it('opens and closes the groups too on expand all and collapse all', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.expandAll();
    expect(shown(store.snapshot().rows)).toEqual([
      '[apex]+',
      'a+@1',
      'b@2',
      'c@2',
      'f@1',
      '[soql]+',
      'd+@1',
      'e@2',
    ]);
    await store.collapseAll();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]-']);
  });

  it('steps through the groups as the top level', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.expandLevel();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]+', 'a-@1', 'f@1', '[soql]+', 'd-@1']);
    await store.expandLevel();
    await store.collapseLevel();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]+', 'a-@1', 'f@1', '[soql]+', 'd-@1']);
    await store.collapseLevel();
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]-']);
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
    await store.setSort({ value: self, dir: 'asc' }, { value: (g) => g.totals.self, dir: 'desc' });
    // soql totals 20, apex 11.
    expect(shown(store.snapshot().rows)).toEqual(['[soql]-', '[apex]+', 'f@1', 'a-@1']);
  });

  it('keeps the default order for groups whose totals tie', async () => {
    const roots = [n('p', 'x', 1), n('q', 'y', 1), n('r', 'y', 0)];
    const store = new GridStore(source(roots), { groupBy: byKind, calcs: { self: sum(self) } });
    await store.setSort(null, { value: (g) => g.totals.self, dir: 'asc' });
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
    const rows = store.snapshot().rows;
    expect(await store.reveal(['a', 'c'])).toBe(3);
    expect(store.snapshot().rows).toBe(rows);
  });

  it('closes a group by hand after expand all, and starts a new grouping closed', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.expandAll();
    await store.toggle(groupOf(store, 'apex'));
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]+', 'd+@1', 'e@2']);
    expect(await store.reveal(['a', 'c'])).toBe(3);
    await store.setGroupBy(byKind);
    expect(shown(store.snapshot().rows)).toEqual(['[apex]-', '[soql]-']);
  });

  it('puts every row back closed on ungroup after expand all', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.expandAll();
    await store.setGroupBy(null);
    expect(shown(store.snapshot().rows)).toEqual(['a-@0', 'd-@0', 'f@0']);
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

  it('keeps totals across sort, expansion and the same calcs set again', async () => {
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
    await store.setSort({ value: self, dir: 'desc' });
    await store.toggle(groupOf(store, 'apex'));
    await store.expandAll();
    await store.setCalcs({ count: counted });
    expect(runs).toBe(before);
    await store.setFilters([]);
    expect(runs).toBeGreaterThan(before);
  });

  it('keeps the footer of each set of filters, so turning a filter back on sums nothing', async () => {
    let runs = 0;
    const counted = {
      scope: 'all' as const,
      of: (rows: readonly Node[]): number => {
        runs++;
        return rows.length;
      },
    };
    const notB = { test: (r: Node) => r.key !== 'b' };
    const store = new GridStore(source(tree()), { calcs: { count: counted } });
    await store.setFilters([notB]);
    expect(store.snapshot().totals.count).toBe(5);
    await store.setFilters([]);
    expect(store.snapshot().totals.count).toBe(6);
    const before = runs;
    await store.setFilters([notB]);
    expect(store.snapshot().totals.count).toBe(5);
    await store.setFilters([]);
    expect(store.snapshot().totals.count).toBe(6);
    expect(runs).toBe(before);
    await store.setFilters([{ test: notB.test }]);
    expect(runs).toBe(before + 1);
    await store.setCalcs({ count: counted });
    expect(runs).toBe(before + 1);
  });

  it('sums only the calcs it has not summed, and keeps the rows on screen', async () => {
    const runs: string[] = [];
    const counted = (name: string) => ({
      scope: 'all' as const,
      of: (rows: readonly Node[]): number => {
        runs.push(name);
        return rows.length;
      },
    });
    const first = counted('first');
    const second = counted('second');
    const store = new GridStore(source(tree()), { calcs: { first } });
    await store.settled();
    const rows = store.snapshot().rows;

    await store.setCalcs({ first, second });
    expect(runs).toEqual(['first', 'second']);
    expect(store.snapshot().totals).toEqual({ first: 6, second: 6 });
    expect(store.snapshot().rows).toBe(rows);

    await store.setCalcs({ second });
    await store.setCalcs({ first, second });
    expect(runs).toEqual(['first', 'second']);
    expect(store.snapshot().totals).toEqual({ first: 6, second: 6 });
  });

  it('builds the groups again when the calcs change', async () => {
    const store = new GridStore(source(tree()), { groupBy: byKind });
    await store.settled();
    await store.setCalcs({ self: sum(self) });
    expect(groupOf(store, 'apex').totals).toEqual({ self: 11 });
  });

  it('runs a calc that yields in slices, for the footer and each group', async () => {
    const sliced = {
      *of(rows: readonly Node[]): Generator<void, number, void> {
        let total = 0;
        for (const row of rows) {
          total += row.self;
          yield;
        }
        return total;
      },
    };
    const store = new GridStore(source(tree()), {
      groupBy: byKind,
      calcs: { self: sliced },
      scheduler: slowScheduler(),
    });
    await store.settled();
    expect(store.snapshot().totals.self).toBe(31);
    expect(groupOf(store, 'soql').totals.self).toBe(20);
  });

  it('sums and maxes in slices', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => n(`r${i}`, 'apex', 1));
    for (const calc of [sum(self), max(self)]) {
      const out = calc.of(rows);
      if (typeof out === 'number') {
        throw new Error('expected a generator');
      }
      let yields = 0;
      while (!out.next().done) {
        yields++;
      }
      expect(yields).toBeGreaterThan(1);
    }
  });

  it('gives a max of 0 for no rows', () => {
    const out = max(self).of([]);
    const total = typeof out === 'number' ? out : out.next();
    expect(total).toEqual({ value: 0, done: true });
  });
});
