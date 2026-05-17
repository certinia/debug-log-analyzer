import { getFilteredDataTreeRows } from '../DataTreeFilter.js';

type Node = {
  id: string;
  value: number;
  _children?: Node[];
};

describe('getFilteredDataTreeRows', () => {
  it('returns all rows from active anchors when no filter is configured', () => {
    const root: Node = {
      id: 'root',
      value: 0,
      _children: [
        { id: 'a', value: 1, _children: [{ id: 'a1', value: 11 }] },
        { id: 'b', value: 2 },
      ],
    };

    const table = {
      getRows: () => [{ getData: () => root }],
      modules: {},
      options: {},
    };

    const result = getFilteredDataTreeRows<Node>(table);
    expect(result.map((row) => row.id)).toEqual(['root', 'a', 'a1', 'b']);
  });

  it('applies the table filter to anchors and descendants', () => {
    const root: Node = {
      id: 'root',
      value: 1,
      _children: [
        { id: 'drop', value: 0, _children: [{ id: 'drop-child', value: 1 }] },
        { id: 'keep', value: 2, _children: [{ id: 'keep-child', value: 3 }] },
      ],
    };

    const table = {
      getRows: () => [{ getData: () => root }],
      modules: {
        filter: {
          filterRow: (row: { getData(): Node }) => row.getData().value > 0,
        },
      },
      options: {
        dataTreeFilter: true,
      },
    };

    const result = getFilteredDataTreeRows<Node>(table);
    expect(result.map((row) => row.id)).toEqual(['root', 'keep', 'keep-child']);
  });

  it('skips filtering when dataTreeFilter is disabled', () => {
    const root: Node = {
      id: 'root',
      value: 0,
      _children: [{ id: 'child', value: 0 }],
    };

    const table = {
      getRows: () => [{ getData: () => root }],
      modules: {
        filter: {
          filterRow: () => false,
        },
      },
      options: {
        dataTreeFilter: false,
      },
    };

    const result = getFilteredDataTreeRows<Node>(table);
    expect(result.map((row) => row.id)).toEqual(['root', 'child']);
  });

  it('honors a custom dataTreeChildField', () => {
    const root = {
      id: 'root',
      value: 1,
      kids: [{ id: 'child', value: 1 }],
    } as unknown as Node;

    const table = {
      getRows: () => [{ getData: () => root }],
      modules: {},
      options: {
        dataTreeChildField: 'kids',
      },
    };

    const result = getFilteredDataTreeRows<Node>(table);
    expect(result.map((row) => row.id)).toEqual(['root', 'child']);
  });
});
