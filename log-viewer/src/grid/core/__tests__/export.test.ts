/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { GridStore, sortComparator, type ExportColumn, type TreeSource } from '../index.js';

interface Node {
  key: string;
  name: string;
  self: number | null;
  kind: string;
  children?: Node[];
}

const n = (
  key: string,
  name: string,
  self: number | null,
  kind: string,
  ...children: Node[]
): Node => ({
  key,
  name,
  self,
  kind,
  children: children.length ? children : undefined,
});

const tree = (): Node[] => [
  n('a', 'say "hi"', 3, 'apex', n('b', 'tab\there', null, 'dml')),
  n('d', 'query', 1, 'soql'),
];

const source = (roots: Node[]): TreeSource<Node> => ({
  roots,
  children: (row) => row.children,
  key: (row) => row.key,
});

const columns: ExportColumn<Node>[] = [
  { title: 'Name', value: (r) => r.name },
  { title: 'Self', value: (r) => r.self },
];

describe('GridStore.exportText', () => {
  it('writes CSV with every value quoted, rows nothing has opened included', async () => {
    const store = new GridStore(source(tree()));
    expect(await store.exportText(columns, { format: 'csv' })).toBe(
      [
        '"Level","Name","Self"',
        '"1","say ""hi""","3"',
        '"2","tab\there",""',
        '"1","query","1"',
      ].join('\n'),
    );
  });

  it('writes the rows in display order, under the sort and filters', async () => {
    const store = new GridStore(source(tree()));
    await store.setSort(sortComparator<Node>({ value: (r) => r.self }, 'asc'));
    await store.setFilters([{ test: (r) => r.key !== 'b' }]);
    expect(await store.exportText(columns, { format: 'tsv' })).toBe(
      ['Name\tSelf', 'query\t1', 'say "hi"\t3'].join('\n'),
    );
  });

  it('writes tab-separated text with a cell kept on one line', async () => {
    const store = new GridStore(source(tree()));
    const text = await store.exportText(columns, { format: 'tsv' });
    expect(text?.split('\n')[2]).toBe('2\ttab here\t');
  });

  it('writes every line once, with no gap or join where its parts meet', async () => {
    const roots = Array.from({ length: 10_000 }, (_, i) => n(`r${i}`, `row ${i}`, i, 'apex'));
    const store = new GridStore(source(roots));
    const text = await store.exportText(columns, { format: 'tsv' });
    expect(text).toBe(['Name\tSelf', ...roots.map((r) => `${r.name}\t${r.self}`)].join('\n'));
  });

  it('writes each group before its rows, and only top-level rows when asked', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    expect(await store.exportText(columns, { format: 'tsv', tree: false })).toBe(
      ['Name\tSelf', 'apex', 'say "hi"\t3', 'soql', 'query\t1'].join('\n'),
    );
  });

  it('starts each line with its level, 1 for a top-level row', async () => {
    const roots = [
      n('a', 'a', 1, 'apex', n('b', 'b', 2, 'apex', n('c', 'c', 3, 'apex'))),
      n('d', 'd', 4, 'soql'),
    ];
    const store = new GridStore(source(roots));
    expect(await store.exportText(columns, { format: 'tsv' })).toBe(
      ['Level\tName\tSelf', '1\ta\t1', '2\tb\t2', '3\tc\t3', '1\td\t4'].join('\n'),
    );
  });

  it('writes no Level column when no row has children', async () => {
    const store = new GridStore(source([n('a', 'a', 1, 'apex'), n('d', 'd', 4, 'soql')]));
    expect(await store.exportText(columns, { format: 'tsv' })).toBe(
      ['Name\tSelf', 'a\t1', 'd\t4'].join('\n'),
    );
  });

  it('writes no Level column for top-level rows only', async () => {
    const store = new GridStore(source(tree()));
    expect(await store.exportText(columns, { format: 'tsv', tree: false })).toBe(
      ['Name\tSelf', 'say "hi"\t3', 'query\t1'].join('\n'),
    );
  });

  it('writes a group at level 1, and its rows one level down', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    expect(await store.exportText(columns, { format: 'tsv' })).toBe(
      [
        'Level\tName\tSelf',
        '1\tapex',
        '2\tsay "hi"\t3',
        '3\ttab here\t',
        '1\tsoql',
        '2\tquery\t1',
      ].join('\n'),
    );
  });
});
