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

import { render } from 'lit';

import { storeOf } from '#test-helpers/apexLog.js';
import { NO_REPORTED_LIMITS_TEXT } from '../../../../components/governorCopy.js';
import { LvGrid, type GridColumn } from '../../../../grid/index.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import {
  createGovernorMetricColumns,
  createSelfSumHeapFooters,
} from '../../components/TableShared.js';
import { toBottomUpTree } from '../../utils/Aggregation.js';
import { toTimeOrderTree, type TimeOrderRow } from '../../utils/TimeOrderTree.js';
import { CallTreeGrid, categoryClass } from '../CallTreeGrid.js';
import { nameCell } from '../cells.js';
import { BOTTOM_UP_SORT, bottomUpColumns, timeOrderColumns } from '../columns.js';
import { sumDurationTotalForRootEvents } from '../../../analysis/services/CallStackSum.js';

const { log } = storeOf(
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
    '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:3\n' +
    '09:18:22.6 (5000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
);
const options = { openType: jest.fn() };
const timeOrder = timeOrderColumns(log, options);
const rows = toTimeOrderTree(log.children, log.governorLimits) ?? [];

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

const allRows = (roots: readonly TimeOrderRow[]): TimeOrderRow[] =>
  roots.flatMap((r) => [r, ...allRows(r._children ?? [])]);

const shown = (content: unknown): HTMLElement => {
  const host = document.createElement('div');
  render(content, host);
  return host;
};

describe('timeOrderColumns', () => {
  it('has the Tabulator columns, in their order, shown and hidden as they were', () => {
    const tabulator = createGovernorMetricColumns(
      log,
      createSelfSumHeapFooters(() => undefined),
    );
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
    const row = { ...rows[0]!, governorCost: null };
    expect(shown(gov.cell(row)).textContent).toBe('—');
    expect(gov.tooltip?.(row)).toBe(NO_REPORTED_LIMITS_TEXT);
    expect(shown(gov.total?.(total(gov.calc, [row]))).textContent).toBe('—');
  });

  it('writes time as milliseconds, which find and copy use', () => {
    const time = column(timeOrder, 'duration.total');
    expect(time.text?.({ ...rows[0]!, duration: { total: 1_234_567, self: 0 } })).toBe('1.23');
  });
});

describe('nameCell', () => {
  const named = (text: string): TimeOrderRow | undefined =>
    allRows(rows).find((r) => r.originalData.text === text);
  const outer = named('ns.Outer.run()');
  const query = named('SELECT Id FROM Account');

  it('opens the type of a method from its link', () => {
    const cell = shown(nameCell(outer?.originalData, '', options.openType));
    cell.querySelector('a')?.click();
    expect(options.openType).toHaveBeenCalledWith('ns.Outer.run()');
  });

  it('shows a query as highlighted SOQL', () => {
    const cell = shown(nameCell(query?.originalData, '', options.openType));
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

describe('lv-call-tree-grid', () => {
  it('colours a row by the category of its event, and leaves others plain', () => {
    expect(categoryClass({ originalData: { category: 'SOQL' } })).toBe('cat-soql');
    expect(categoryClass({ originalData: { category: 'Code Unit' } })).toBe('cat-codeUnit');
    expect(categoryClass({ originalData: { category: 'Unknown' } })).toBeUndefined();
    expect(categoryClass({})).toBeUndefined();
    expect(document.createElement('lv-call-tree-grid').rowClass).toBe(categoryClass);
  });

  it('is an lv-grid', () => {
    expect(document.createElement('lv-call-tree-grid')).toBeInstanceOf(CallTreeGrid);
    expect(document.createElement('lv-call-tree-grid')).toBeInstanceOf(LvGrid);
  });
});
