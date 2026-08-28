/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent } from 'apex-log-parser';
import type { RowComponent, Tabulator } from 'tabulator-tables';

// The grid brings tabulator and its module registrations, which don't load under
// jest; this suite drives only the selection the view reports to the inspector.
jest.mock('../../../call-tree/components/BottomUpTable.js', () => ({
  createBottomUpTable: () => ({
    table: {
      on: (name: string, handler: unknown) => handlers.set(name, handler),
      getRows: (...args: unknown[]) => {
        stub.getRowsArgs.push(args);
        return stub.rows;
      },
      goToRow: (row: RowComponent) => stub.revealed.push(row),
    },
    // Left pending: the columns are applied on build, and none are set up here.
    tableBuilt: new Promise<Tabulator>(() => {}),
  }),
}));
// vscode-button needs ElementInternals.setFormValue (absent in jsdom).
jest.mock('#vscode-elements/vscode-button.js', () => ({}));
jest.mock('#vscode-elements/vscode-option.js', () => ({}));
jest.mock('#vscode-elements/vscode-toolbar-button.js', () => ({}));

import {
  eventBus,
  type DetailSelection,
  type DetailSource,
} from '../../../../core/events/EventBus.js';
import { toBottomUpTree, type BottomUpRow } from '../../../call-tree/utils/Aggregation.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import { AnalysisView } from '../AnalysisView.js';
import { LocatedRowMarker } from '../../../../components/locatedRow.js';

const handlers = new Map<string, unknown>();
/** The stub table's state, so a reveal's reads can be counted. */
let stub: { rows: RowComponent[]; getRowsArgs: unknown[][]; revealed: RowComponent[] };

/** The log's own index, which a reveal resolves its frame through, and which the
 *  fixture's event indexes count off. */
let byEventIndex: LogEvent[] = [];

function frame(text: string, self: number, total: number, parent: LogEvent | null): LogEvent {
  const event = {
    eventIndex: byEventIndex.length,
    type: 'METHOD_ENTRY',
    namespace: 'default',
    text,
    parent,
    children: [],
    duration: { self, total },
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    soslCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    thrownCount: { self: 0, total: 0 },
    heapAllocated: { self: 0, total: 0 },
    heapGross: { self: 0, total: 0 },
    heapPeak: 0,
  } as unknown as LogEvent;
  parent?.children.push(event);
  byEventIndex.push(event);
  return event;
}

/**
 * A -> B -> A on one branch, A -> C -> A on the other, under a log root as the
 * parser leaves it: a bottom-up chain runs out to the root and stops there, so a
 * top-level frame with no parent above it would name no row for its own callees.
 *
 * A derived row's calls come from the log's own key table, so the view must read
 * the log the rows were built from.
 */
function recursiveLog(): ApexLog {
  const root = frame('LOG_ROOT', 0, 150, null);
  const outer1 = frame('A', 10, 100, root);
  const b1 = frame('B', 20, 90, outer1);
  frame('A', 70, 70, b1);
  const outer2 = frame('A', 5, 50, root);
  const c1 = frame('C', 15, 45, outer2);
  frame('A', 30, 30, c1);
  return Object.assign(root, { eventsById: byEventIndex }) as unknown as ApexLog;
}

function rowComponent(data: BottomUpRow, treeParent?: RowComponent): RowComponent {
  return {
    getData: () => data,
    getTreeParent: () => treeParent ?? false,
  } as unknown as RowComponent;
}

function findRow(rows: BottomUpRow[], text: string): BottomUpRow {
  const row = rows.find((candidate) => candidate.text === text);
  if (!row) {
    throw new Error(`Unable to find row for ${text}`);
  }
  return row;
}

describe('analysis-view selection', () => {
  let view: AnalysisView;
  let log: ApexLog;
  let roots: BottomUpRow[];
  let seen: Array<{ source: DetailSource; selection: DetailSelection | null }>;
  let off: () => void;

  beforeEach(() => {
    byEventIndex = [];
    handlers.clear();
    stub = { rows: [], getRowsArgs: [], revealed: [] };
    log = recursiveLog();
    roots = toBottomUpTree(log.children, logStoreFor(log).keyPathIds());
    view = new AnalysisView();
    // The app hands the log down as a property, and a row's calls are read
    // through the table that built it.
    view.timelineRoot = log;
    // The table mounts in a wrapper the view finds in its render root; it has
    // none until it is updated, so stand one in.
    view.tableContainer = document.createElement('div');
    void view._renderAnalysis(log);
    seen = [];
    off = eventBus.on('detail:select', (detail) => seen.push(detail));
  });

  afterEach(() => {
    off();
    view.disconnectedCallback();
  });

  function select(row: RowComponent): void {
    (handlers.get('rowSelectionChanged') as (data: unknown, rows: RowComponent[]) => void)(null, [
      row,
    ]);
  }

  it('scopes a root row to every call it counts', () => {
    const rootRow = findRow(roots, 'A');

    select(rowComponent(rootRow));

    expect(seen).toEqual([
      {
        source: 'analysis',
        view: 'callers',
        selection: {
          kind: 'aggregate',
          instances: rootRow.instances.map((event) => event.eventIndex),
          // The root row names the calls it counts, so nothing made them but it.
          calledBy: undefined,
        },
      },
    ]);
  });

  it('scopes a caller row to the calls it holds, and names the row they were reached through', () => {
    const rootRow = findRow(roots, 'A');
    const throughB = findRow(rootRow._children ?? [], 'B');
    const throughBA = findRow(throughB._children ?? [], 'A');
    const throughBComponent = rowComponent(throughB, rowComponent(rootRow));

    select(throughBComponent);
    select(rowComponent(throughBA, throughBComponent));

    const derived = rootRow.instances.filter((event) => event.parent?.text === 'B');
    expect(derived).toHaveLength(1);
    expect(seen.map((detail) => detail.selection)).toEqual([
      // Both rows hold the same one call, so the row is what tells them apart:
      // reached through B, then through the A above B.
      {
        kind: 'aggregate',
        instances: derived.map((event) => event.eventIndex),
        calledBy: 'B',
      },
      {
        kind: 'aggregate',
        instances: derived.map((event) => event.eventIndex),
        calledBy: 'A',
      },
    ]);
  });

  it('reveals a bucket by its key, reading no occurrence', async () => {
    // The grid lists root buckets; a dataTree hands only those back.
    stub.rows = roots.map((data) => rowComponent(data));

    // Frame 2 is the log's own `B` call, which the `B` bucket heads.
    eventBus.emit('inspector:reveal', { source: 'analysis', eventIndex: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stub.revealed.map((row) => row.getData())).toEqual([findRow(roots, 'B')]);
    // One read of the top-level rows, and never `getRows('active')`: listing the
    // active rows, or reading a bucket's occurrences, walked the whole log.
    expect(stub.getRowsArgs).toEqual([[]]);
  });

  it('moves to the bucket a picked inspector row names', async () => {
    stub.rows = roots.map((data) => rowComponent(data));

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A hover only marks; a pick moves the grid, as it does in every other view.
    expect(stub.revealed.map((row) => row.getData())).toEqual([findRow(roots, 'B')]);
  });

  it('only marks for a row under the pointer', async () => {
    stub.rows = roots.map((data) => rowComponent(data));

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stub.revealed).toEqual([]);
  });

  it('drops a mark a later report has replaced', async () => {
    stub.rows = roots.map((data) => rowComponent(data));
    const marks: Array<readonly (number | string)[]> = [];
    const spy = jest.spyOn(LocatedRowMarker.prototype, 'mark').mockImplementation((_host, ids) => {
      marks.push(ids);
    });

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: true });
    // The pick is dropped while the reveal it started is still in flight.
    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [], sticky: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(marks.at(-1)).toEqual([]);
    spy.mockRestore();
  });

  it('clears the inspector when the selection goes', () => {
    (handlers.get('rowSelectionChanged') as (data: unknown, rows: RowComponent[]) => void)(
      null,
      [],
    );

    expect(seen).toEqual([{ source: 'analysis', selection: null, view: 'callers' }]);
  });
});
