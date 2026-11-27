/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { GridStore } from '../index.js';
import { slowScheduler, source } from './fixtures.js';

interface Node {
  key: string;
  name: string;
  note: string;
  kind: string;
  children?: Node[];
}

const n = (key: string, name: string, note: string, kind: string, ...children: Node[]): Node => ({
  key,
  name,
  note,
  kind,
  children: children.length ? children : undefined,
});

/**
 *   a "Account"        d "account.save"
 *   ├ b "Contact"      └ e "Account Account"
 *   │ └ c "AccountX"
 *   └ x "Lead"
 */
const tree = (): Node[] => [
  n(
    'a',
    'Account',
    '',
    'apex',
    n('b', 'Contact', 'account', 'dml', n('c', 'AccountX', '', 'dml')),
    n('x', 'Lead', '', 'apex'),
  ),
  n('d', 'account.save', '', 'soql', n('e', 'Account Account', '', 'dml')),
];

const name = (r: Node): string => r.name;
const note = (r: Node): string => r.note;

/** The key of the row that holds each match, in match order. */
const holders = (
  result: { total: number; rowOf(match: number): { key: string } | undefined } | null,
): string[] =>
  result ? Array.from({ length: result.total }, (_, i) => result.rowOf(i)?.key ?? '?') : [];

describe('GridStore.find', () => {
  it('counts every match in every row that passes the filters, open or not', async () => {
    const store = new GridStore(source(tree()));
    const result = await store.find({ text: 'account' }, [name]);
    expect(holders(result)).toEqual(['a', 'c', 'd', 'e', 'e']);
  });

  it('matches case when asked to', async () => {
    const store = new GridStore(source(tree()));
    const result = await store.find({ text: 'account', matchCase: true }, [name]);
    expect(holders(result)).toEqual(['d']);
  });

  it('matches the text literally', async () => {
    const store = new GridStore(source(tree()));
    expect((await store.find({ text: 't.s' }, [name]))?.total).toBe(1);
    expect((await store.find({ text: 'a(' }, [name]))?.total).toBe(0);
  });

  it('matches a space in the text to any run of whitespace, so a search goes across a line break', async () => {
    const store = new GridStore(source([n('q', 'SELECT Id\n  FROM Account', '', 'soql')]));
    expect((await store.find({ text: 'id from' }, [name]))?.total).toBe(1);
    expect((await store.find({ text: 'idfrom' }, [name]))?.total).toBe(0);
  });

  it('searches only the cells it is given, so a hidden column adds nothing', async () => {
    const store = new GridStore(source(tree()));
    expect((await store.find({ text: 'account' }, [name]))?.total).toBe(5);
    expect((await store.find({ text: 'account' }, [name, note]))?.total).toBe(6);
  });

  it('numbers matches in display order, under the sort and filters', async () => {
    const roots = tree();
    const store = new GridStore(source(roots));
    await store.setSort({ value: (r) => r.key, dir: 'desc' });
    await store.setFilters([{ test: (r) => r.key !== 'c' }]);
    const result = await store.find({ text: 'account' }, [name]);
    expect(holders(result)).toEqual(['d', 'e', 'e', 'a']);
    const c = roots[0]?.children?.[0]?.children?.[0] as Node;
    expect(result?.firstMatchIn(c)).toBe(-1);
  });

  it('gives each row its first match number', async () => {
    const roots = tree();
    const store = new GridStore(source(roots));
    const result = await store.find({ text: 'account' }, [name]);
    const [a, d] = roots as [Node, Node];
    expect(result?.firstMatchIn(a)).toBe(0);
    expect(result?.firstMatchIn(d.children?.[0] as Node)).toBe(3);
    expect(result?.firstMatchIn(d)).toBe(2);
  });

  it('gives the path to a match', async () => {
    const store = new GridStore(source(tree()));
    const result = await store.find({ text: 'accountx' }, [name]);
    expect(result?.pathOf(0)).toEqual(['a', 'b', 'c']);
  });

  it('searches the rows in each group and their trees, not the group rows', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    const result = await store.find({ text: 'account' }, [name, (r) => r.kind]);
    expect(holders(result)).toEqual(['a', 'c', 'd', 'e', 'e']);
  });

  it('finds nothing for empty text', async () => {
    const store = new GridStore(source(tree()));
    expect((await store.find({ text: '' }, [name]))?.total).toBe(0);
  });

  it('drops an older find once a newer one starts', async () => {
    const roots = Array.from({ length: 2000 }, (_, i) => n(`r${i}`, 'Account', '', 'apex'));
    const store = new GridStore(source(roots), { scheduler: slowScheduler() });
    await store.settled();
    const older = store.find({ text: 'acc' }, [name]);
    const newer = store.find({ text: 'count' }, [name]);
    expect(await older).toBeNull();
    expect((await newer)?.total).toBe(2000);
  });
});

describe('FindResult.firstMatchFrom', () => {
  /** The first match at or after each shown row, by the row's key, then past the end. */
  async function fromEachRow(
    store: GridStore<Node>,
    text: string,
    cells: ((r: Node) => string)[],
  ): Promise<(string | number)[]> {
    const result = await store.find({ text }, cells);
    const { rows } = store.snapshot();
    return Array.from({ length: rows.size + 1 }, (_, i) =>
      i < rows.size
        ? `${rows.keyAt(i)}:${result?.firstMatchFrom(rows, i)}`
        : (result?.firstMatchFrom(rows, i) ?? -1),
    );
  }

  it('gives the first match on or below each shown row, and the total past the end', async () => {
    const store = new GridStore(source(tree()));
    await store.expandAll();

    // Matches: a 0, c 1, d 2, e 3 and 4.
    expect(await fromEachRow(store, 'account', [name])).toEqual([
      'a:0',
      'b:1',
      'c:1',
      'x:2',
      'd:2',
      'e:3',
      5,
    ]);
  });

  it('counts a match in a collapsed row at the shown row above it', async () => {
    const store = new GridStore(source(tree()));
    await store.settled();

    // Only b's note matches, and b is hidden under a.
    expect(await fromEachRow(store, 'account', [note])).toEqual(['a:0', 'd:1', 1]);
  });

  it('counts a match in a collapsed group at its group row', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    await store.collapseAll();

    // The soql group holds d and e, hidden; apex holds a and c.
    expect(await fromEachRow(store, 'account', [name])).toEqual(['apex:0', 'soql:2', 5]);
  });
});
