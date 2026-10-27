/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { render } from 'lit';

import { storeOf } from '#test-helpers/apexLog.js';
import { runCalc as total } from '#test-helpers/calcs.js';
import { governorLimits, limitValue } from '#test-helpers/limits.js';
import { NO_REPORTED_LIMITS_TEXT } from '../../../../components/governorCopy.js';
import { CALL_TREE_VIEWS } from '../../../../components/grid/ColumnViews.js';
import { formatInteger } from '../../../../core/utility/Util.js';
import { FIND_TEXT_ATTR, type GridColumn } from '../../../../grid/index.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import {
  toAggregatedCallTree,
  toBottomUpTree,
  type AggregatedRow,
} from '../../utils/Aggregation.js';
import { toTimeOrderTree, type TimeOrderRow } from '../../utils/TimeOrderTree.js';
import { reportedUsage } from '../../utils/reportedUsage.js';
import { CallTreeGrid, categoryClass } from '../CallTreeGrid.js';
import { nameCell } from '../cells.js';
import {
  AGGREGATED_WITHOUT_DETAILS,
  aggregatedColumns,
  BOTTOM_UP_WITHOUT_DETAILS,
  BOTTOM_UP_SORT,
  bottomUpColumns,
  mergedLines,
  TIME_ORDER_WITHOUT_DETAILS,
  timeOrderColumns,
  timeOrderSource,
} from '../columns.js';
import { sumDurationTotalForRootEvents } from '../../../analysis/services/CallStackSum.js';

const { log } = storeOf(
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
    '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:3\n' +
    '09:18:22.6 (5000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
);
const options = { openType: jest.fn() };
const timeOrder = timeOrderColumns(log, options);
const rows = log.children;

/** `event` with one field changed, the rest read through to it. */
function withField<K extends keyof LogEvent>(
  event: LogEvent,
  key: K,
  value: LogEvent[K],
): LogEvent {
  const copy: LogEvent = Object.create(event);
  Object.defineProperty(copy, key, { value });
  return copy;
}

const column = <R>(columns: GridColumn<R>[], id: string): GridColumn<R> => {
  const found = columns.find((c) => c.id === id);
  if (!found) {
    throw new Error(`no column ${id}`);
  }
  return found;
};

const allRows = (roots: readonly LogEvent[]): LogEvent[] =>
  roots.flatMap((r) => [r, ...allRows(r.children)]);

const builtRows = (roots: readonly TimeOrderRow[]): TimeOrderRow[] =>
  roots.flatMap((r) => [r, ...builtRows(r._children ?? [])]);

const shown = (content: unknown): HTMLElement => {
  const host = document.createElement('div');
  render(content, host);
  return host;
};

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
    const row = rows[0]!;
    expect(shown(gov.cell(row)).textContent).toBe('—');
    expect(gov.tooltip?.(row)).toBe(NO_REPORTED_LIMITS_TEXT);
    expect(shown(gov.total?.(total(gov.calc, [row]) ?? Number.NaN)).textContent).toBe('—');
  });

  it('writes heap bytes as formatInteger does', () => {
    const heap = column(timeOrder, 'heapPeak');
    for (const bytes of [0, 999, 1_572_864.4, -12_000_000]) {
      expect(heap.text?.(withField(rows[0]!, 'heapPeak', bytes))).toBe(formatInteger(bytes));
    }
  });

  it('writes time as milliseconds, which find and copy use', () => {
    const time = column(timeOrder, 'duration.total');
    const row = withField(rows[0]!, 'duration', { total: 1_234_567, self: 0 });
    expect(time.text?.(row)).toBe('1.23');
  });

  it('shows on each event what the built Time Order row held', () => {
    const limited: ApexLog = Object.create(log);
    Object.defineProperty(limited, 'governorLimits', {
      value: governorLimits({
        soqlQueries: limitValue(0, 100),
        queryRows: limitValue(0, 50_000),
      }),
    });
    const columns = timeOrderColumns(limited, options);
    const built = builtRows(toTimeOrderTree(log.children, limited.governorLimits) ?? []);
    const events = allRows(rows);
    expect(events.map((e) => e.eventIndex)).toEqual(built.map((r) => r.id));
    const held: Record<string, (r: TimeOrderRow) => string | number | null> = {
      callerNamespace: (r) => r.callerNamespace,
      type: (r) => r.type,
      governorCost: (r) => r.governorCost?.toFixed(0) ?? null,
      governorCostMax: (r) => r.governorCostMax?.toFixed(0) ?? null,
    };
    for (const [id, value] of Object.entries(held)) {
      const { text } = column(columns, id);
      expect(events.map((e) => text?.(e))).toEqual(built.map((r) => String(value(r) ?? '—')));
    }
    expect(built.some((r) => (r.governorCost ?? 0) > 0)).toBe(true);
  });
});

describe('CALL_TREE_VIEWS', () => {
  it('names only columns a call-tree grid has, so no view loses a column to a rename', () => {
    const ids = new Set(
      [timeOrder, aggregatedColumns(log, options), bottomUpColumns(log, options)].flatMap(
        (columns) => columns.map((c) => c.id),
      ),
    );
    const named = CALL_TREE_VIEWS.flatMap((view) => view.fields ?? []);

    expect(named.filter((field) => !ids.has(field))).toEqual([]);
  });
});

describe('timeOrderSource', () => {
  it('reads the tree from the events, keyed by event index', () => {
    const source = timeOrderSource(log);
    const outer = rows[0]!;
    expect(source.roots).toBe(log.children);
    expect(source.children?.(outer)).toBe(outer.children);
    expect(source.key(outer)).toBe(outer.eventIndex);
  });
});

describe('Details filters', () => {
  const { log: mixed, store: mixedStore } = storeOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
      '09:18:22.6 (1000)|METHOD_ENTRY|[2]|01p|ns.Instant.run()\n' +
      '09:18:22.6 (1000)|METHOD_EXIT|[2]|ns.Instant.run()\n' +
      '09:18:22.6 (1000)|METHOD_ENTRY|[2]|01p|ns.Instant.run()\n' +
      '09:18:22.6 (1000)|METHOD_EXIT|[2]|ns.Instant.run()\n' +
      '09:18:22.6 (1000)|METHOD_ENTRY|[2]|01p|ns.Instant.run()\n' +
      '09:18:22.6 (1000)|METHOD_EXIT|[2]|ns.Instant.run()\n' +
      '09:18:22.6 (2000)|USER_DEBUG|[3]|DEBUG|hello\n' +
      '09:18:22.6 (3000)|EXCEPTION_THROWN|[4]|System.NullPointerException: boom\n' +
      '09:18:22.6 (4000)|CUMULATIVE_LIMIT_USAGE\n' +
      '09:18:22.6 (4000)|LIMIT_USAGE_FOR_NS|(default)|\n' +
      '  Number of SOQL queries: 5 out of 100\n' +
      '09:18:22.6 (4000)|STATIC_VARIABLE_LIST|\n' +
      '09:18:22.6 (5000)|CUMULATIVE_LIMIT_USAGE_END\n' +
      '09:18:22.6 (6000)|METHOD_EXIT|[1]|ns.Outer.run()\n' +
      '09:18:22.6 (7000)|FATAL_ERROR|System.LimitException: Apex CPU time limit exceeded\n' +
      '09:18:22.6 (8000)|CUMULATIVE_PROFILING_BEGIN\n' +
      '09:18:22.6 (8000)|CUMULATIVE_PROFILING|SOQL operations|\n' +
      '09:18:22.6 (9000)|CUMULATIVE_PROFILING_END\n',
  );
  const frames = ['EXECUTION_STARTED', 'CODE_UNIT_STARTED', 'METHOD_ENTRY', 'METHOD_ENTRY'];
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

  it('keeps frames and pinned details in Time Order', () => {
    const kept = allRows(mixed.children).filter((e) => TIME_ORDER_WITHOUT_DETAILS.test(e));
    expect(kept.map((e) => e.type).sort()).toEqual(
      [...frames, 'METHOD_ENTRY', 'METHOD_ENTRY', ...pinned].sort(),
    );
  });

  it('keeps frames and pinned details in Aggregated, a method that took no time included', () => {
    const rows = merged(toAggregatedCallTree(mixed.children, mixedStore.keyPathIds()));
    const kept = rows.filter((row) => AGGREGATED_WITHOUT_DETAILS.test(row));
    expect(kept.map((row) => row.type).sort()).toEqual([...frames, ...pinned].sort());
    const instant = kept.find((row) => row.text === 'ns.Instant.run()');
    expect([instant?.callCount, instant?.totalTime]).toEqual([3, 0]);
  });

  // The static variable list sat under a pinned limit block, and Bottom-Up showed it.
  it('keeps frames only in Bottom-Up, a method that took no time included', () => {
    const roots = toBottomUpTree(mixed.children, mixedStore.keyPathIds());
    const kept = roots.filter((row) => BOTTOM_UP_WITHOUT_DETAILS.test(row));
    expect(kept.map((row) => row.type).sort()).toEqual([...frames].sort());
    const instant = kept.find((row) => row.text === 'ns.Instant.run()');
    expect([instant?.callCount, instant?.totalTime]).toEqual([3, 0]);
    expect(roots.map((row) => row.type)).toContain('STATIC_VARIABLE_LIST');
  });
});

describe('nameCell', () => {
  const named = (text: string): LogEvent | undefined => allRows(rows).find((r) => r.text === text);
  const outer = named('ns.Outer.run()');
  const query = named('SELECT Id FROM Account');

  it('opens the type of a method from its link', () => {
    const cell = shown(nameCell(outer, '', options.openType));
    cell.querySelector('a')?.click();
    expect(options.openType).toHaveBeenCalledWith('ns.Outer.run()');
  });

  it('shows a query as highlighted SOQL', () => {
    const cell = shown(nameCell(query, '', options.openType));
    expect(cell.querySelector('.soql-block')?.textContent).toContain('SELECT');
  });
});

describe('bottomUpColumns', () => {
  const columns = bottomUpColumns(log, options);
  const roots = toBottomUpTree(log.children, logStoreFor(log).keyPathIds(), log.governorLimits);

  it('counts each call once in the total time footer', () => {
    expect(total(column(columns, 'totalTime').calc, roots)).toBe(
      sumDurationTotalForRootEvents(roots.map((r) => r.instances)),
    );
  });

  it('counts each query and its rows once in the footer, though the method and query rows both hold them', () => {
    // One query of 3 rows, inside ns.Outer.run(): both are top-level Bottom-Up rows.
    expect(total(column(columns, 'soqlCount.total').calc, roots)).toBe(1);
    expect(total(column(columns, 'soqlRowCount.total').calc, roots)).toBe(3);
  });

  it('opens sorted by a column it has', () => {
    expect(column(columns, BOTTOM_UP_SORT.column).sort).toBeDefined();
  });
});

describe('aggregatedColumns', () => {
  const columns = aggregatedColumns(log, options);
  const roots = toAggregatedCallTree(
    log.children,
    logStoreFor(log).keyPathIds(),
    log.governorLimits,
  );
  const all = (of: readonly AggregatedRow[]): AggregatedRow[] =>
    of.flatMap((r) => [r, ...all(r._children ?? [])]);

  it('has its columns in order, with Type and Avg Self Time hidden', () => {
    const ids = columns.map((c) => c.id);
    expect(ids.slice(0, 5)).toEqual(['text', 'namespace', 'callerNamespace', 'type', 'callCount']);
    expect(ids.slice(-3)).toEqual(['totalTime', 'totalSelfTime', 'avgSelfTime']);
    expect(column(columns, 'type').hidden).toBe(true);
    expect(column(columns, 'avgSelfTime').hidden).toBe(true);
  });

  it('sums total time over top-level rows, and self time over every row', () => {
    expect(total(column(columns, 'totalTime').calc, roots)).toBe(
      roots.reduce((sum, r) => sum + r.totalTime, 0),
    );
    expect(column(columns, 'totalSelfTime').calc?.scope).toBe('all');
    expect(total(column(columns, 'totalSelfTime').calc, all(roots))).toBe(
      all(roots).reduce((sum, r) => sum + r.totalSelfTime, 0),
    );
  });
});

describe('mergedLines', () => {
  it('counts the lines of the text and suffix of the row event', () => {
    const event = rows[0]!;
    expect(mergedLines({ originalData: event })).toBe(1);
    expect(mergedLines({ originalData: withField(event, 'text', 'a\nb\nc') })).toBe(3);
    expect(
      mergedLines({
        originalData: withField(withField(event, 'text', 'a\nb'), 'suffix', ' (x)\ny'),
      }),
    ).toBe(3);
    expect(
      mergedLines({ originalData: withField(event, 'suffix', null as unknown as string) }),
    ).toBe(1);
  });
});

describe('copy', () => {
  afterEach(() => document.body.replaceChildren());

  it('copies the shown columns and every row, with a query as the log has it', async () => {
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const roots = toAggregatedCallTree(log.children, logStoreFor(log).keyPathIds());
    const grid = new CallTreeGrid<AggregatedRow>();
    grid.columns = aggregatedColumns(log, options);
    grid.source = { roots, children: (r) => r._children ?? undefined, key: (r) => r.id };
    document.body.append(grid);
    await grid.updateComplete;
    await grid.settled();

    await grid.copy();

    const [head, ...rows] = writeText.mock.calls[0]?.[0].split('\n') ?? [];
    expect(head).toMatch(/^Level\tName\tNamespace\tCalls\tDML\t/);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.split('\t')[1])).toContain('SELECT Id FROM Account');
  });
});

describe('find text', () => {
  const limited: ApexLog = Object.create(log);
  Object.defineProperty(limited, 'governorLimits', {
    value: governorLimits({ soqlQueries: limitValue(0, 100), queryRows: limitValue(0, 50_000) }),
  });
  const pathIds = logStoreFor(log).keyPathIds();
  const flat = <R extends { _children?: R[] | null }>(roots: readonly R[]): R[] =>
    roots.flatMap((r) => [r, ...flat(r._children ?? [])]);
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

  it('is what each searched Time Order cell shows', () => {
    check(timeOrderColumns(limited, options), allRows(rows));
  });

  it('is what each searched Aggregated cell shows', () => {
    const roots = toAggregatedCallTree(log.children, pathIds, limited.governorLimits);
    check(aggregatedColumns(limited, options), flat(roots));
  });

  it('is what each searched Bottom-Up cell shows', () => {
    const roots = toBottomUpTree(log.children, pathIds, limited.governorLimits);
    check(bottomUpColumns(limited, options), flat(roots));
  });
});

describe('export text', () => {
  const columns = aggregatedColumns(log, options);

  it('writes a query as the log has it, where the cell shows it formatted', () => {
    const all = (of: readonly AggregatedRow[]): AggregatedRow[] =>
      of.flatMap((r) => [r, ...all(r._children ?? [])]);
    const roots = toAggregatedCallTree(log.children, logStoreFor(log).keyPathIds());
    const query = all(roots).find((r) => r.originalData.type === 'SOQL_EXECUTE_BEGIN');
    const name = columns.find((c) => c.id === 'text');
    if (!query || !name) {
      throw new Error('no query row or Name column');
    }
    expect(name.exportText?.(query)).toBe('SELECT Id FROM Account');
    expect(name.text?.(query)).not.toBe('SELECT Id FROM Account');
  });

  it('writes a governor percentage in full, where the cell shows it rounded', () => {
    const cost = columns.find((c) => c.id === 'governorCost');
    const row = { governorCost: 33.375 } as unknown as AggregatedRow;
    expect(cost?.exportText?.(row)).toBe('33.375');
    expect(cost?.text?.(row)).toBe('33');
  });
});

describe('lv-call-tree-grid', () => {
  it('colours a row by the category of its event, and leaves others plain', () => {
    expect(categoryClass({ originalData: { category: 'SOQL' } })).toBe('cat-soql');
    expect(categoryClass({ originalData: { category: 'Code Unit' } })).toBe('cat-codeUnit');
    expect(categoryClass({ originalData: { category: 'Unknown' } })).toBeUndefined();
    expect(categoryClass({})).toBeUndefined();
    expect(categoryClass({ category: 'SOQL' })).toBe('cat-soql');
    expect(document.createElement('lv-call-tree-grid').rowClass).toBe(categoryClass);
  });
});

describe('Reported columns', () => {
  // The cumulative block says 5 queries ran by then; the method's events show 1.
  const { log: reportedLog, store } = storeOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|Outer.run()\n' +
      '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
      '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:3\n' +
      '09:18:22.6 (4000)|CUMULATIVE_LIMIT_USAGE\n' +
      '09:18:22.6 (4000)|LIMIT_USAGE_FOR_NS|(default)|\n' +
      '  Number of SOQL queries: 5 out of 100\n' +
      '09:18:22.6 (4000)|CUMULATIVE_LIMIT_USAGE_END\n' +
      '09:18:22.6 (5000)|METHOD_EXIT|[1]|Outer.run()\n',
  );
  const outer = (): LogEvent => {
    const found = allRows(reportedLog.children).find((e) => e.text === 'Outer.run()');
    if (!found) {
      throw new Error('no Outer.run()');
    }
    return found;
  };

  it('sits after its Seen column, hidden until a view or the user shows it', async () => {
    const columns = timeOrderColumns(reportedLog, {
      ...options,
      reported: await store.derive(reportedUsage),
    });
    const ids = columns.map((c) => c.id);

    expect(ids.indexOf('soqlCount.reported')).toBe(ids.indexOf('soqlCount.total') + 1);
    expect(column(columns, 'soqlCount.reported').hidden).toBe(true);
  });

  it('tints a row where Salesforce reported a different count, and states both', async () => {
    const reported = column(
      timeOrderColumns(reportedLog, { ...options, reported: await store.derive(reportedUsage) }),
      'soqlCount.reported',
    );

    expect(reported.text?.(outer())).toBe('5');
    expect(reported.tooltip?.(outer())).toBe('Used 5 · Seen 1');
    expect(shown(reported.cell(outer())).querySelector('.reported-differs')).not.toBeNull();
  });

  it('keeps two alike queries alike, and puts the correction on the row that holds the report', async () => {
    // Two queries seen, then Salesforce reports it charged one.
    const { log, store: twoStore } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|Outer.run()\n' +
        '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Plugin__mdt\n' +
        '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
        '09:18:22.6 (4000)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Plugin__mdt\n' +
        '09:18:22.6 (5000)|SOQL_EXECUTE_END|[3]|Rows:1\n' +
        '09:18:22.6 (6000)|CUMULATIVE_LIMIT_USAGE\n' +
        '09:18:22.6 (6000)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 1 out of 100\n' +
        '09:18:22.6 (6000)|CUMULATIVE_LIMIT_USAGE_END\n' +
        '09:18:22.6 (7000)|METHOD_EXIT|[1]|Outer.run()\n',
    );
    const reported = column(
      timeOrderColumns(log, { ...options, reported: await twoStore.derive(reportedUsage) }),
      'soqlCount.reported',
    );
    const rows = allRows(log.children);
    const queries = rows.filter((e) => e.type === 'SOQL_EXECUTE_BEGIN');
    const method = rows.find((e) => e.text === 'Outer.run()');

    expect(queries.map((e) => reported.text?.(e))).toEqual(['1', '1']);
    expect(method && reported.text?.(method)).toBe('1');
    // Used equals Seen on each query, so neither is tinted.
    expect(queries.map((e) => shown(reported.cell(e)).querySelector('.reported-differs'))).toEqual([
      null,
      null,
    ]);
  });

  it('reads Used from a Bottom-Up row, which holds its own sum', async () => {
    const usage = await store.derive(reportedUsage);
    const roots = toBottomUpTree(reportedLog.children, store.keyPathIds(), undefined, usage);
    const row = roots.find((r) => r.text === 'Outer.run()');
    const reported = column(
      bottomUpColumns(reportedLog, { ...options, reported: usage }),
      'soqlCount.reported',
    );

    expect(row && reported.text?.(row)).toBe('5');
  });

  it('counts the usage once in the Bottom-Up footer, though nested rows hold it too', async () => {
    const usage = await store.derive(reportedUsage);
    const roots = toBottomUpTree(reportedLog.children, store.keyPathIds(), undefined, usage);
    const reported = column(
      bottomUpColumns(reportedLog, { ...options, reported: usage }),
      'soqlCount.reported',
    );

    // The log used 5 in all, whichever rows hold it.
    expect(total(reported.calc, roots)).toBe(5);
  });

  it('gives the lines that report a limit none of it: the method around them used it', async () => {
    const reported = column(
      timeOrderColumns(reportedLog, { ...options, reported: await store.derive(reportedUsage) }),
      'soqlCount.reported',
    );
    const reporters = allRows(reportedLog.children).filter((e) =>
      ['CUMULATIVE_LIMIT_USAGE', 'LIMIT_USAGE_FOR_NS'].includes(e.type ?? ''),
    );

    expect(reporters).not.toHaveLength(0);
    expect(reporters.map((e) => reported.text?.(e))).toEqual(reporters.map(() => '0'));
  });

  it('shows — where the log reported no usage', () => {
    const reported = column(timeOrderColumns(reportedLog, options), 'soqlCount.reported');

    expect(reported.text?.(outer())).toBe('—');
    expect(shown(reported.cell(outer())).querySelector('.reported-differs')).toBeNull();
  });
});
