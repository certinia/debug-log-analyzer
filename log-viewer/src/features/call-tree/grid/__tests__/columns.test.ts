/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
  Renderer: class {},
}));
// The Tabulator column definitions are compared as data; no table is built.

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { render } from 'lit';

import { storeOf } from '#test-helpers/apexLog.js';
import { governorLimits, limitValue } from '#test-helpers/limits.js';
import { NO_REPORTED_LIMITS_TEXT } from '../../../../components/governorCopy.js';
import { formatInteger } from '../../../../core/utility/Util.js';
import { FIND_TEXT_ATTR, LvGrid, type GridColumn } from '../../../../grid/index.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import { createGovernorMetricColumns } from '../../components/TableShared.js';
import {
  toAggregatedCallTree,
  toBottomUpTree,
  type AggregatedRow,
} from '../../utils/Aggregation.js';
import { toTimeOrderTree, type TimeOrderRow } from '../../utils/TimeOrderTree.js';
import { CallTreeGrid, categoryClass, eventCategoryClass } from '../CallTreeGrid.js';
import { nameCell } from '../cells.js';
import {
  aggregatedColumns,
  BOTTOM_UP_SORT,
  bottomUpColumns,
  mergedLines,
  TIME_ORDER_DETAILS,
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

function total<R>(calc: GridColumn<R>['calc'], of: readonly R[]): number {
  const out = calc?.of(of);
  if (out === undefined || typeof out === 'number') {
    return out ?? Number.NaN;
  }
  let step = out.next();
  while (!step.done) {
    step = out.next();
  }
  return step.value;
}

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
  it('has the Tabulator columns, in their order, shown and hidden as they were', () => {
    const tabulator = createGovernorMetricColumns(log, {
      netTotal: 'sum',
      netSelf: 'sum',
      grossTotal: 'sum',
      grossSelf: 'sum',
    });
    const fields = tabulator.map((c) => c.field);
    const ours = timeOrder.filter((c) => fields.includes(c.id));
    expect(ours.map((c) => [c.id, c.title, c.width, c.hidden ?? false])).toEqual(
      tabulator.map((c) => [c.field, c.title, c.width, c.visible === false]),
    );
    expect(timeOrder.map((c) => c.id).filter((id) => !fields.includes(id))).toEqual([
      'text',
      'namespace',
      'callerNamespace',
      'type',
      'duration.total',
      'duration.self',
    ]);
  });

  it('sums total time over top-level rows, and self time over every row', () => {
    const all = allRows(rows);
    expect(total(column(timeOrder, 'duration.total').calc, rows)).toBe(
      rows.reduce((sum, r) => sum + r.duration.total, 0),
    );
    expect(column(timeOrder, 'duration.self').calc?.scope).toBe('all');
    expect(total(column(timeOrder, 'duration.self').calc, all)).toBe(
      all.reduce((sum, r) => sum + r.duration.self, 0),
    );
  });

  it('shows an unknown utilisation as a dash, in the cell, the tooltip and the footer', () => {
    const gov = column(timeOrder, 'governorCost');
    const row = rows[0]!;
    expect(shown(gov.cell(row)).textContent).toBe('—');
    expect(gov.tooltip?.(row)).toBe(NO_REPORTED_LIMITS_TEXT);
    expect(shown(gov.total?.(total(gov.calc, [row]))).textContent).toBe('—');
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

describe('timeOrderSource', () => {
  it('reads the tree from the events, keyed by event index', () => {
    const source = timeOrderSource(log);
    const outer = rows[0]!;
    expect(source.roots).toBe(log.children);
    expect(source.children?.(outer)).toBe(outer.children);
    expect(source.key(outer)).toBe(outer.eventIndex);
  });

  it('shows the details the built rows marked, keeping the parents of a detail', () => {
    const built = builtRows(toTimeOrderTree(log.children, log.governorLimits) ?? []);
    const deep = (e: LogEvent): boolean =>
      TIME_ORDER_DETAILS.test(e) || e.children.some((c) => deep(c));
    expect(TIME_ORDER_DETAILS.keepAncestors).toBe(true);
    expect(allRows(rows).map(deep)).toEqual(built.map((r) => r._hasDetailsDeep));
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

  it('has the Tabulator columns, in their order, with Type and Avg Self Time hidden', () => {
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
  const pathIds = logStoreFor(log).keyPathIds();
  const merged = <R extends { id: number; _children?: R[] | null }>(roots: R[]) => ({
    roots,
    children: (r: R) => r._children ?? undefined,
    key: (r: R) => r.id,
  });
  const views = {
    'time order': () => ({ columns: timeOrder, source: timeOrderSource(log) }),
    aggregated: () => ({
      columns: aggregatedColumns(log, options),
      source: merged(toAggregatedCallTree(log.children, pathIds, log.governorLimits)),
    }),
    'bottom up': () => ({
      columns: bottomUpColumns(log, options),
      source: merged(toBottomUpTree(log.children, pathIds, log.governorLimits)),
    }),
  };

  afterEach(() => document.body.replaceChildren());

  it.each([
    ['time order', 'Level\tName\tNamespace\tDML Count', ['EXECUTION_STARTED', 'ns.Outer.run()'], 4],
    [
      'aggregated',
      'Level\tName\tNamespace\tCalls\tDML Count',
      ['EXECUTION_STARTED', 'ns.Outer.run()'],
      4,
    ],
    ['bottom up', 'Level\tName\tNamespace\tType\tCalls', ['apex://pkg.Entry (code unit)'], 10],
  ] as const)(
    'copies %s: the shown columns, and every row, closed or not',
    async (view, header, first, lines) => {
      const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const grid = document.createElement('lv-call-tree-grid') as CallTreeGrid;
      Object.assign(grid, views[view]());
      document.body.append(grid);
      await grid.updateComplete;
      await grid.settled();

      await grid.copy();

      const [head, ...rows] = writeText.mock.calls[0]?.[0].split('\n') ?? [];
      expect(head).toMatch(new RegExp(`^${header}\t`));
      expect(rows).toHaveLength(lines);
      expect(rows.map((r) => r.split('\t')[1])).toEqual(expect.arrayContaining([...first]));
    },
  );
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
    expect(eventCategoryClass({ category: 'SOQL' })).toBe('cat-soql');
    expect(eventCategoryClass({})).toBeUndefined();
    expect(document.createElement('lv-call-tree-grid').rowClass).toBe(categoryClass);
  });

  it('is an lv-grid', () => {
    expect(document.createElement('lv-call-tree-grid')).toBeInstanceOf(CallTreeGrid);
    expect(document.createElement('lv-call-tree-grid')).toBeInstanceOf(LvGrid);
  });
});
