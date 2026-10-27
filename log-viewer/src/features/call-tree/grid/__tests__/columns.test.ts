/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { render } from 'lit';

import { rawStoreOf } from '#test-helpers/apexLog.js';
import { runCalc as total } from '#test-helpers/calcs.js';
import { NO_REPORTED_LIMITS_TEXT } from '../../../../components/governorCopy.js';
import { CALL_TREE_VIEWS } from '../../../../components/grid/ColumnViews.js';
import type { LogStore } from '#core/log/LogStore.js';
import { formatInteger } from '#core/utility/Util.js';
import { FIND_TEXT_ATTR, type GridColumn } from '../../../../grid/index.js';
import {
  toAggregatedCallTree,
  toBottomUpTree,
  type AggregatedRow,
} from '../../utils/Aggregation.js';
import { reportedUsage } from '../../utils/reportedUsage.js';
import { TimeOrderSource, type TimeOrderNode } from '../../utils/TimeOrderTree.js';
import { CallTreeGrid, categoryClass } from '../CallTreeGrid.js';
import { nameCell } from '../cells.js';
import {
  AGGREGATED_WITHOUT_DETAILS,
  aggregatedColumns,
  BOTTOM_UP_WITHOUT_DETAILS,
  BOTTOM_UP_SORT,
  bottomUpColumns,
  mergedLines,
  timeOrderColumns,
} from '../columns.js';

const line = (at: number, rest: string): string => `09:18:22.6 (${at})|${rest}\n`;

/** A method that runs one query of 3 rows. */
const BODY =
  line(1000, 'METHOD_ENTRY|[1]|01p|ns.Outer.run()') +
  line(2000, 'SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account') +
  line(3000, 'SOQL_EXECUTE_END|[2]|Rows:3') +
  line(5000, 'METHOD_EXIT|[1]|ns.Outer.run()');

/** {@link BODY}, then a limit block that names the query limits. */
const LIMITED_BODY =
  BODY +
  line(6000, 'CUMULATIVE_LIMIT_USAGE') +
  line(6000, 'LIMIT_USAGE_FOR_NS|(default)|') +
  '  Number of SOQL queries: 1 out of 100\n' +
  '  Number of query rows: 3 out of 50000\n' +
  line(6000, 'CUMULATIVE_LIMIT_USAGE_END');

const options = { openType: jest.fn() };

async function storeOf(body: string): Promise<LogStore> {
  return (await rawStoreOf(body)).store;
}

async function sourceOf(store: LogStore): Promise<TimeOrderSource> {
  return new TimeOrderSource(await store.logIndex());
}

/** Every node of `source`, in pre-order. */
function allNodes(source: TimeOrderSource): TimeOrderNode[] {
  const walk = (nodes: readonly TimeOrderNode[]): TimeOrderNode[] =>
    nodes.flatMap((node) => [node, ...walk(source.children(node) ?? [])]);
  return walk(source.roots);
}

/** The node of the event whose text is `text`. */
function nodeOf(store: LogStore, source: TimeOrderSource, text: string): TimeOrderNode {
  const found = allNodes(source).find((node) => store.log.event(source.key(node))?.text === text);
  if (!found) {
    throw new Error(`no node for ${text}`);
  }
  return found;
}

const column = <R>(columns: GridColumn<R>[], id: string): GridColumn<R> => {
  const found = columns.find((c) => c.id === id);
  if (!found) {
    throw new Error(`no column ${id}`);
  }
  return found;
};

const flat = <R extends { _children?: R[] | null }>(roots: readonly R[]): R[] =>
  roots.flatMap((r) => [r, ...flat(r._children ?? [])]);

const shown = (content: unknown): HTMLElement => {
  const host = document.createElement('div');
  render(content, host);
  return host;
};

let store: LogStore;
let source: TimeOrderSource;
let timeOrder: GridColumn<TimeOrderNode>[];

beforeAll(async () => {
  store = await storeOf(BODY);
  source = await sourceOf(store);
  timeOrder = timeOrderColumns(source, options);
});

describe('timeOrderColumns', () => {
  it('has the name, namespace, type and time columns, in their order', () => {
    const named = [
      'text',
      'namespace',
      'callerNamespace',
      'type',
      'duration.total',
      'duration.self',
    ];
    expect(timeOrder.map((c) => c.id).filter((id) => named.includes(id))).toEqual(named);
  });

  it('sums total time over top-level rows, and self time over every row', () => {
    expect(column(timeOrder, 'duration.total').calc?.scope).not.toBe('all');
    expect(column(timeOrder, 'duration.self').calc?.scope).toBe('all');
  });

  it('shows an unknown utilisation as a dash, in the cell, the tooltip and the footer', () => {
    const gov = column(timeOrder, 'governorCost');
    const row = source.roots[0]!;
    expect(shown(gov.cell(row)).textContent).toBe('—');
    expect(gov.tooltip?.(row)).toBe(NO_REPORTED_LIMITS_TEXT);
    expect(shown(gov.total?.(total(gov.calc, [row]) ?? Number.NaN)).textContent).toBe('—');
  });

  it('writes time as milliseconds, which find and copy use', async () => {
    const timed = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|ns.A.run()') + line(1_235_567, 'METHOD_EXIT|[1]|ns.A.run()'),
    );
    const timedSource = await sourceOf(timed);
    const time = column(timeOrderColumns(timedSource, options), 'duration.total');

    expect(time.text?.(timedSource.roots[0]!)).toBe('1.23');
  });

  it('reads each row from its own event', () => {
    const outer = nodeOf(store, source, 'ns.Outer.run()');
    const query = nodeOf(store, source, 'SELECT Id FROM Account');
    const text = (id: string, node: TimeOrderNode) => column(timeOrder, id).text?.(node);

    expect([text('type', outer), text('type', query)]).toEqual([
      'METHOD_ENTRY',
      'SOQL_EXECUTE_BEGIN',
    ]);
    expect(text('soqlRowCount.total', outer)).toBe('3');
    expect(text('soqlCount.self', outer)).toBe('0');
    expect(text('soqlCount.self', query)).toBe('1');
    // The query's caller is the method, which states no namespace.
    expect(text('callerNamespace', query)).toBe('default');
  });

  // SOQL 1/100 is 1%, query rows 3/50,000 near 0%: the average rounds to 1, as does the peak.
  it('measures each row against the limits the log reported', async () => {
    const limited = await storeOf(LIMITED_BODY);
    const limitedSource = await sourceOf(limited);
    const columns = timeOrderColumns(limitedSource, options);
    const outer = nodeOf(limited, limitedSource, 'ns.Outer.run()');

    expect(column(columns, 'governorCost').text?.(outer)).toBe('1');
    expect(column(columns, 'governorCostMax').text?.(outer)).toBe('1');
  });
});

describe('CALL_TREE_VIEWS', () => {
  it('names only columns a call-tree grid has, so no view loses a column to a rename', () => {
    const { log } = store;
    const ids = new Set(
      [timeOrder, aggregatedColumns(log, options), bottomUpColumns(log, options)].flatMap(
        (columns) => columns.map((c) => c.id),
      ),
    );
    const named = CALL_TREE_VIEWS.flatMap((view) => view.fields ?? []);

    expect(named.filter((field) => !ids.has(field))).toEqual([]);
  });
});

describe('TimeOrderSource', () => {
  it('reads the tree from the index, keyed by event id', () => {
    const [outer] = source.roots;
    const children = source.children(outer!);

    expect(source.roots).toHaveLength(1);
    expect(store.log.event(source.key(outer!))?.text).toBe('ns.Outer.run()');
    expect(children?.map((child) => store.log.event(source.key(child))?.type)).toEqual([
      'SOQL_EXECUTE_BEGIN',
    ]);
  });

  // The grid holds its work per row object, so a new array on each ask would lose it.
  it('hands back the same child nodes each time it is asked', () => {
    const [outer] = source.roots;

    expect(source.children(outer!)).toBe(source.children(outer!));
  });

  it('shows frames and exceptions with Details off, and not a bare leaf', async () => {
    const detailed = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|ns.A.run()') +
        line(1100, 'STATEMENT_EXECUTE|[2]') +
        line(1200, 'EXCEPTION_THROWN|[3]|System.NullPointerException: boom') +
        line(2000, 'METHOD_EXIT|[1]|ns.A.run()'),
    );
    const detailedSource = await sourceOf(detailed);
    const typeOf = (node: TimeOrderNode) => detailed.log.event(detailedSource.key(node))?.type;

    expect(
      allNodes(detailedSource).map((node) => [
        typeOf(node),
        detailedSource.withoutDetails.test(node),
      ]),
    ).toEqual([
      ['METHOD_ENTRY', true],
      ['STATEMENT_EXECUTE', false],
      ['EXCEPTION_THROWN', true],
    ]);
  });

  // The filter keeps no ancestors for its rows, so a parent of only bare leaves must show on its own.
  it('shows every row that holds others, whatever they are', async () => {
    // 0 ms, so only its kind can show it: a frame, or a limit block that is not one.
    const bare = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|ns.A.run()') +
        line(1000, 'STATEMENT_EXECUTE|[2]') +
        line(1000, 'HEAP_ALLOCATE|[3]|Bytes:8') +
        line(1000, 'METHOD_EXIT|[1]|ns.A.run()') +
        line(1000, 'CUMULATIVE_LIMIT_USAGE') +
        line(1000, 'STATIC_VARIABLE_LIST|') +
        line(1000, 'CUMULATIVE_LIMIT_USAGE_END'),
    );
    const bareSource = await sourceOf(bare);
    const parents = allNodes(bareSource).filter((node) => bareSource.children(node)?.length);
    const typeOf = (node: TimeOrderNode) => bare.log.event(bareSource.key(node))?.type;

    expect(parents.map(typeOf)).toEqual(['METHOD_ENTRY', 'CUMULATIVE_LIMIT_USAGE']);
    expect(parents.every((node) => bareSource.withoutDetails.test(node))).toBe(true);
  });
});

describe('Details filters', () => {
  let mixed: LogStore;
  beforeAll(async () => {
    mixed = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|ns.Outer.run()') +
        line(1000, 'METHOD_ENTRY|[2]|01p|ns.Instant.run()') +
        line(1000, 'METHOD_EXIT|[2]|ns.Instant.run()') +
        line(1000, 'METHOD_ENTRY|[2]|01p|ns.Instant.run()') +
        line(1000, 'METHOD_EXIT|[2]|ns.Instant.run()') +
        line(1000, 'METHOD_ENTRY|[2]|01p|ns.Instant.run()') +
        line(1000, 'METHOD_EXIT|[2]|ns.Instant.run()') +
        line(2000, 'USER_DEBUG|[3]|DEBUG|hello') +
        line(3000, 'EXCEPTION_THROWN|[4]|System.NullPointerException: boom') +
        line(4000, 'CUMULATIVE_LIMIT_USAGE') +
        line(4000, 'LIMIT_USAGE_FOR_NS|(default)|') +
        '  Number of SOQL queries: 5 out of 100\n' +
        line(4000, 'STATIC_VARIABLE_LIST|') +
        line(5000, 'CUMULATIVE_LIMIT_USAGE_END') +
        line(6000, 'METHOD_EXIT|[1]|ns.Outer.run()') +
        line(7000, 'FATAL_ERROR|System.LimitException: Apex CPU time limit exceeded') +
        line(8000, 'CUMULATIVE_PROFILING_BEGIN') +
        line(8000, 'CUMULATIVE_PROFILING|SOQL operations|') +
        line(9000, 'CUMULATIVE_PROFILING_END'),
    );
  });
  const frames = ['METHOD_ENTRY', 'METHOD_ENTRY'];
  const pinned = [
    'EXCEPTION_THROWN',
    'CUMULATIVE_LIMIT_USAGE',
    'LIMIT_USAGE_FOR_NS',
    'FATAL_ERROR',
    'CUMULATIVE_PROFILING_BEGIN',
    'CUMULATIVE_PROFILING',
  ];
  const merged = <R extends { _children?: R[] | null }>(roots: readonly R[]): R[] =>
    roots.flatMap((r) => [r, ...merged(r._children ?? [])]);

  it('keeps frames and pinned details in Time Order', async () => {
    const mixedSource = await sourceOf(mixed);
    const kept = allNodes(mixedSource).filter((node) => mixedSource.withoutDetails.test(node));
    expect(kept.map((node) => mixed.log.event(mixedSource.key(node))?.type).sort()).toEqual(
      [...frames, 'METHOD_ENTRY', 'METHOD_ENTRY', ...pinned].sort(),
    );
  });

  it('keeps frames and pinned details in Aggregated, a method that took no time included', async () => {
    const rows = merged(toAggregatedCallTree(await mixed.logIndex(), mixed));
    const kept = rows.filter((row) => AGGREGATED_WITHOUT_DETAILS.test(row));
    expect(kept.map((row) => row.type).sort()).toEqual([...frames, ...pinned].sort());
    const instant = kept.find((row) => row.text === 'ns.Instant.run()');
    expect([instant?.callCount, instant?.totalTime]).toEqual([3, 0]);
  });

  // The static variable list sat under a pinned limit block, and Bottom-Up showed it.
  it('keeps frames only in Bottom-Up, a method that took no time included', async () => {
    const roots = toBottomUpTree(await mixed.logIndex(), mixed);
    const kept = roots.filter((row) => BOTTOM_UP_WITHOUT_DETAILS.test(row));
    expect(kept.map((row) => row.type).sort()).toEqual([...frames].sort());
    const instant = kept.find((row) => row.text === 'ns.Instant.run()');
    expect([instant?.callCount, instant?.totalTime]).toEqual([3, 0]);
    expect(roots.map((row) => row.type)).toContain('STATIC_VARIABLE_LIST');
  });

  // Parser 0.4 marks this line a leaf, not a frame; parser 0.3, and so main, showed it as a call.
  it('keeps a VF call with no method, which has no exit, in every view', async () => {
    const vf = await storeOf(
      line(
        1000,
        'VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController invoke(getseverities)',
      ),
    );
    const vfSource = await sourceOf(vf);
    const index = await vf.logIndex();

    expect(allNodes(vfSource).filter((node) => vfSource.withoutDetails.test(node))).toHaveLength(1);
    expect(
      toAggregatedCallTree(index, vf).filter((row) => AGGREGATED_WITHOUT_DETAILS.test(row)),
    ).toHaveLength(1);
    expect(
      toBottomUpTree(index, vf).filter((row) => BOTTOM_UP_WITHOUT_DETAILS.test(row)),
    ).toHaveLength(1);
  });
});

describe('nameCell', () => {
  it('opens the type of a method from its link', () => {
    const id = source.key(nodeOf(store, source, 'ns.Outer.run()'));
    const cell = shown(nameCell(store.log, id, '', options.openType));
    cell.querySelector('a')?.click();
    expect(options.openType).toHaveBeenCalledWith('ns.Outer.run()');
  });

  it('shows a query as highlighted SOQL', () => {
    const id = source.key(nodeOf(store, source, 'SELECT Id FROM Account'));
    const cell = shown(nameCell(store.log, id, '', options.openType));
    expect(cell.querySelector('.soql-block')?.textContent).toContain('SELECT');
  });
});

describe('bottomUpColumns', () => {
  it('counts each call once in the total time footer', async () => {
    const columns = bottomUpColumns(store.log, options);
    const roots = toBottomUpTree(await store.logIndex(), store);

    // The method's 4,000 ns holds the query's 1,000.
    expect(total(column(columns, 'totalTime').calc, roots)).toBe(4000);
  });

  it('counts each query and its rows once in the footer, though the method and query rows both hold them', async () => {
    const columns = bottomUpColumns(store.log, options);
    const roots = toBottomUpTree(await store.logIndex(), store);

    // One query of 3 rows, inside ns.Outer.run(): both are top-level Bottom-Up rows.
    expect(total(column(columns, 'soqlCount.total').calc, roots)).toBe(1);
    expect(total(column(columns, 'soqlRowCount.total').calc, roots)).toBe(3);
  });

  it('opens sorted by a column it has', () => {
    expect(column(bottomUpColumns(store.log, options), BOTTOM_UP_SORT.column).sort).toBeDefined();
  });
});

describe('aggregatedColumns', () => {
  it('has its columns in order, with Type and Avg Self Time hidden', () => {
    const columns = aggregatedColumns(store.log, options);
    const ids = columns.map((c) => c.id);
    expect(ids.slice(0, 5)).toEqual(['text', 'namespace', 'callerNamespace', 'type', 'callCount']);
    expect(ids.slice(-3)).toEqual(['totalTime', 'totalSelfTime', 'avgSelfTime']);
    expect(column(columns, 'type').hidden).toBe(true);
    expect(column(columns, 'avgSelfTime').hidden).toBe(true);
  });

  it('sums total time over top-level rows, and self time over every row', async () => {
    const columns = aggregatedColumns(store.log, options);
    const roots = toAggregatedCallTree(await store.logIndex(), store);

    expect(total(column(columns, 'totalTime').calc, roots)).toBe(4000);
    expect(column(columns, 'totalSelfTime').calc?.scope).toBe('all');
    expect(total(column(columns, 'totalSelfTime').calc, flat(roots))).toBe(4000);
  });

  it('writes heap bytes as formatInteger does', () => {
    const heap = column(aggregatedColumns(store.log, options), 'heapPeak');
    for (const bytes of [0, 999, 1_572_864.4, -12_000_000]) {
      expect(heap.text?.({ heapPeak: bytes } as AggregatedRow)).toBe(formatInteger(bytes));
    }
  });
});

describe('mergedLines', () => {
  it('counts the lines of the text of the row event', async () => {
    const debug = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|ns.A.run()') +
        line(1100, 'USER_DEBUG|[2]|DEBUG|a') +
        'b\nc\n' +
        line(2000, 'METHOD_EXIT|[1]|ns.A.run()'),
    );
    const lines = mergedLines(debug.log);

    expect(lines({ eventIndex: 1 })).toBe(1);
    expect(lines({ eventIndex: 2 })).toBe(3);
  });

  // A grid redraws when it gets a new function, so a render that asks again must not.
  it('hands back one function per log', () => {
    expect(mergedLines(store.log)).toBe(mergedLines(store.log));
  });
});

describe('copy', () => {
  afterEach(() => document.body.replaceChildren());

  it('copies the shown columns and every row, with a query as the log has it', async () => {
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const roots = toAggregatedCallTree(await store.logIndex(), store);
    const grid = new CallTreeGrid<AggregatedRow>();
    grid.columns = aggregatedColumns(store.log, options);
    grid.source = { roots, children: (r) => r._children ?? undefined, key: (r) => r.id };
    document.body.append(grid);
    await grid.updateComplete;
    await grid.settled();

    await grid.copy();

    const [head, ...rows] = writeText.mock.calls[0]?.[0].split('\n') ?? [];
    expect(head).toMatch(/^Level\tName\tNamespace\tCalls\tDML\t/);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.split('\t')[1])).toContain('SELECT Id FROM Account');
  });
});

describe('find text', () => {
  /** What the highlighter searches in a painted cell: its marked find text, or all of it. */
  const searched = (content: unknown): string | null => {
    const cell = shown(content);
    return (cell.querySelector(`[${FIND_TEXT_ATTR}]`) ?? cell).textContent;
  };
  const check = <R>(columns: GridColumn<R>[], of: readonly R[]): void => {
    const searchable = columns.filter((c) => c.text);
    const painted = of.flatMap((row) => searchable.map((c) => [c.id, searched(c.cell(row))]));
    const counted = of.flatMap((row) => searchable.map((c) => [c.id, c.text?.(row)]));
    expect(painted).toEqual(counted);
  };

  it('is what each searched Time Order cell shows', async () => {
    const limited = await storeOf(LIMITED_BODY);
    const limitedSource = await sourceOf(limited);
    check(timeOrderColumns(limitedSource, options), allNodes(limitedSource));
  });

  it('is what each searched Aggregated cell shows', async () => {
    const limited = await storeOf(LIMITED_BODY);
    const roots = toAggregatedCallTree(await limited.logIndex(), limited);
    check(aggregatedColumns(limited.log, options), flat(roots));
  });

  it('is what each searched Bottom-Up cell shows', async () => {
    const limited = await storeOf(LIMITED_BODY);
    const roots = toBottomUpTree(await limited.logIndex(), limited);
    check(bottomUpColumns(limited.log, options), flat(roots));
  });
});

describe('export text', () => {
  it('writes a query as the log has it, where the cell shows it formatted', async () => {
    const columns = aggregatedColumns(store.log, options);
    const roots = toAggregatedCallTree(await store.logIndex(), store);
    const query = flat(roots).find((r) => r.type === 'SOQL_EXECUTE_BEGIN');
    const name = columns.find((c) => c.id === 'text');
    if (!query || !name) {
      throw new Error('no query row or Name column');
    }
    expect(name.exportText?.(query)).toBe('SELECT Id FROM Account');
    expect(name.text?.(query)).not.toBe('SELECT Id FROM Account');
  });

  // The cell is a link or a highlighted query; copy must write the plain name a reader can search for.
  it('writes a frame by its name, with the suffix that tells a constructor from a method', async () => {
    const built = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|ns.Outer.run()') +
        line(2000, 'CONSTRUCTOR_ENTRY|[2]|01p|<init>()|ns.Inner') +
        line(3000, 'CONSTRUCTOR_EXIT|[2]|01p|<init>()|ns.Inner') +
        line(4000, 'METHOD_EXIT|[1]|ns.Outer.run()'),
    );
    const name = aggregatedColumns(built.log, options).find((c) => c.id === 'text');
    const rows = flat(toAggregatedCallTree(await built.logIndex(), built));

    expect(rows.map((row) => name?.exportText?.(row))).toEqual([
      'ns.Outer.run()',
      'ns.Inner() (constructor)',
    ]);
  });

  it('writes a governor percentage in full, where the cell shows it rounded', () => {
    const cost = aggregatedColumns(store.log, options).find((c) => c.id === 'governorCost');
    const row = { governorCost: 33.375 } as unknown as AggregatedRow;
    expect(cost?.exportText?.(row)).toBe('33.375');
    expect(cost?.text?.(row)).toBe('33');
  });
});

describe('lv-call-tree-grid', () => {
  it('colours a row by the category of its event, and leaves others plain', () => {
    expect(categoryClass({ category: 'SOQL' })).toBe('cat-soql');
    expect(categoryClass({ category: 'Code Unit' })).toBe('cat-codeUnit');
    expect(categoryClass({ category: 'Unknown' })).toBeUndefined();
    expect(categoryClass({})).toBeUndefined();
    expect(document.createElement('lv-call-tree-grid').rowClass).toBe(categoryClass);
  });

  it('gives a Time Order row the category of its event', () => {
    const query = nodeOf(store, source, 'SELECT Id FROM Account');

    expect(source.category(query)).toBe('SOQL');
  });
});

describe('Reported columns', () => {
  // The cumulative block says 5 queries ran by then; the method's events show 1.
  const REPORTED_BODY =
    line(1000, 'METHOD_ENTRY|[1]|01p|Outer.run()') +
    line(2000, 'SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account') +
    line(3000, 'SOQL_EXECUTE_END|[2]|Rows:3') +
    line(4000, 'CUMULATIVE_LIMIT_USAGE') +
    line(4000, 'LIMIT_USAGE_FOR_NS|(default)|') +
    '  Number of SOQL queries: 5 out of 100\n' +
    line(4000, 'CUMULATIVE_LIMIT_USAGE_END') +
    line(5000, 'METHOD_EXIT|[1]|Outer.run()');

  let reportedStore: LogStore;
  let reportedSource: TimeOrderSource;
  const outer = (): TimeOrderNode => nodeOf(reportedStore, reportedSource, 'Outer.run()');
  const usedColumn = async (): Promise<GridColumn<TimeOrderNode>> =>
    column(
      timeOrderColumns(reportedSource, {
        ...options,
        reported: await reportedStore.derive(reportedUsage),
      }),
      'soqlCount.reported',
    );

  beforeAll(async () => {
    reportedStore = await storeOf(REPORTED_BODY);
    reportedSource = await sourceOf(reportedStore);
  });

  it('sits after its Seen column, hidden until a view or the user shows it', async () => {
    const columns = timeOrderColumns(reportedSource, {
      ...options,
      reported: await reportedStore.derive(reportedUsage),
    });
    const ids = columns.map((c) => c.id);

    expect(ids.indexOf('soqlCount.reported')).toBe(ids.indexOf('soqlCount.total') + 1);
    expect(column(columns, 'soqlCount.reported').hidden).toBe(true);
  });

  it('tints a row where Salesforce reported a different count, and states both', async () => {
    const reported = await usedColumn();

    expect(reported.text?.(outer())).toBe('5');
    expect(reported.tooltip?.(outer())).toBe('Used 5 · Seen 1');
    expect(shown(reported.cell(outer())).querySelector('.reported-differs')).not.toBeNull();
  });

  it('keeps two alike queries alike, and puts the correction on the row that holds the report', async () => {
    // Two queries seen, then Salesforce reports it charged one.
    const twoStore = await storeOf(
      line(1000, 'METHOD_ENTRY|[1]|01p|Outer.run()') +
        line(2000, 'SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Plugin__mdt') +
        line(3000, 'SOQL_EXECUTE_END|[2]|Rows:1') +
        line(4000, 'SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Plugin__mdt') +
        line(5000, 'SOQL_EXECUTE_END|[3]|Rows:1') +
        line(6000, 'CUMULATIVE_LIMIT_USAGE') +
        line(6000, 'LIMIT_USAGE_FOR_NS|(default)|') +
        '  Number of SOQL queries: 1 out of 100\n' +
        line(6000, 'CUMULATIVE_LIMIT_USAGE_END') +
        line(7000, 'METHOD_EXIT|[1]|Outer.run()'),
    );
    const twoSource = await sourceOf(twoStore);
    const reported = column(
      timeOrderColumns(twoSource, { ...options, reported: await twoStore.derive(reportedUsage) }),
      'soqlCount.reported',
    );
    const typeOf = (node: TimeOrderNode) => twoStore.log.event(twoSource.key(node))?.type;
    const queries = allNodes(twoSource).filter((node) => typeOf(node) === 'SOQL_EXECUTE_BEGIN');
    const method = nodeOf(twoStore, twoSource, 'Outer.run()');

    expect(queries.map((node) => reported.text?.(node))).toEqual(['1', '1']);
    expect(reported.text?.(method)).toBe('1');
    // Used equals Seen on each query, so neither is tinted.
    expect(
      queries.map((node) => shown(reported.cell(node)).querySelector('.reported-differs')),
    ).toEqual([null, null]);
  });

  it('reads Used from a Bottom-Up row, which holds its own sum', async () => {
    const usage = await reportedStore.derive(reportedUsage);
    const roots = toBottomUpTree(await reportedStore.logIndex(), reportedStore, usage);
    const row = roots.find((r) => r.text === 'Outer.run()');
    const reported = column(
      bottomUpColumns(reportedStore.log, { ...options, reported: usage }),
      'soqlCount.reported',
    );

    expect(row && reported.text?.(row)).toBe('5');
  });

  it('counts the usage once in the Bottom-Up footer, though nested rows hold it too', async () => {
    const usage = await reportedStore.derive(reportedUsage);
    const roots = toBottomUpTree(await reportedStore.logIndex(), reportedStore, usage);
    const reported = column(
      bottomUpColumns(reportedStore.log, { ...options, reported: usage }),
      'soqlCount.reported',
    );

    // The log used 5 in all, whichever rows hold it.
    expect(total(reported.calc, roots)).toBe(5);
  });

  it('gives the lines that report a limit none of it: the method around them used it', async () => {
    const reported = await usedColumn();
    const typeOf = (node: TimeOrderNode) =>
      reportedStore.log.event(reportedSource.key(node))?.type ?? '';
    const reporters = allNodes(reportedSource).filter((node) =>
      ['CUMULATIVE_LIMIT_USAGE', 'LIMIT_USAGE_FOR_NS'].includes(typeOf(node)),
    );

    expect(reporters).not.toHaveLength(0);
    expect(reporters.map((node) => reported.text?.(node))).toEqual(reporters.map(() => '0'));
  });

  it('shows — where the log reported no usage', () => {
    const reported = column(timeOrderColumns(reportedSource, options), 'soqlCount.reported');

    expect(reported.text?.(outer())).toBe('—');
    expect(shown(reported.cell(outer())).querySelector('.reported-differs')).toBeNull();
  });
});
