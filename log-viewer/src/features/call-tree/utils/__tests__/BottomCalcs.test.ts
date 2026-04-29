import type { Tabulator } from 'tabulator-tables';

import { makeSumSelfTimeAllVisible } from '../BottomCalcs.js';

interface FakeRow<TData = unknown> {
  data: TData;
  children: FakeRow<TData>[];
}

interface InternalRowLike {
  getData(): unknown;
  __children: FakeRow[];
}

function toInternalRow(row: FakeRow): InternalRowLike {
  return {
    getData: () => row.data,
    __children: row.children,
  };
}

function fakeTable(rootRows: FakeRow[]): Tabulator {
  const internalRows = rootRows.map(toInternalRow);
  return {
    getRows: () =>
      internalRows.map((ir) => ({
        _getSelf: () => ir,
      })),
    modules: {
      dataTree: {
        getFilteredTreeChildren: (row: InternalRowLike) => row.__children.map(toInternalRow),
      },
    },
  } as unknown as Tabulator;
}

describe('bottomCalcs', () => {
  it('makeSumSelfTimeAllVisible sums self time for every visible row in the filtered tree', () => {
    const tree: FakeRow[] = [
      {
        data: { totalSelfTime: 10 },
        children: [
          { data: { totalSelfTime: 40 }, children: [] },
          { data: { totalSelfTime: 5 }, children: [] },
        ],
      },
      {
        data: { totalSelfTime: 20 },
        children: [{ data: { totalSelfTime: 10 }, children: [] }],
      },
    ];
    const calc = makeSumSelfTimeAllVisible(() => fakeTable(tree));
    expect(calc([], [], {})).toBe(10 + 40 + 5 + 20 + 10);
  });

  it('makeSumSelfTimeAllVisible excludes children filtered out of the tree', () => {
    const fullTree: FakeRow[] = [
      {
        data: { totalSelfTime: 10 },
        children: [
          { data: { totalSelfTime: 40 }, children: [] },
          { data: { totalSelfTime: 5 }, children: [] },
        ],
      },
    ];
    const filteredTree: FakeRow[] = [
      {
        data: { totalSelfTime: 10 },
        children: [{ data: { totalSelfTime: 5 }, children: [] }],
      },
    ];

    const fullCalc = makeSumSelfTimeAllVisible(() => fakeTable(fullTree));
    const filteredCalc = makeSumSelfTimeAllVisible(() => fakeTable(filteredTree));

    expect(fullCalc([], [], {})).toBe(55);
    expect(filteredCalc([], [], {})).toBe(15);
  });

  it('makeSumSelfTimeAllVisible returns 0 before the table is available', () => {
    const calc = makeSumSelfTimeAllVisible(() => undefined);
    expect(calc([], [], {})).toBe(0);
  });
});
