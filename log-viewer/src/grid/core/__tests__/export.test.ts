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
      ['"Name","Self"', '"say ""hi""","3"', '"tab\there",""', '"query","1"'].join('\n'),
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
    expect(text?.split('\n')[2]).toBe('tab here\t');
  });

  it('writes each group before its rows, and only top-level rows when asked', async () => {
    const store = new GridStore(source(tree()), { groupBy: (r) => r.kind });
    expect(await store.exportText(columns, { format: 'tsv', tree: false })).toBe(
      ['Name\tSelf', 'apex', 'say "hi"\t3', 'soql', 'query\t1'].join('\n'),
    );
  });
});
