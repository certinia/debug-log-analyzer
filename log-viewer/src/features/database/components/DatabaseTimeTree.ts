/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '../../../components/GridSkeleton.js';
import '../../../components/grid/AppGrid.js';
import { consume } from '@lit/context';
import { LitElement, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';

import type { AppGrid } from '../../../components/grid/AppGrid.js';
import { countColumn, inlineQueryColumn, timeColumn } from '../../../components/grid/columns.js';
import {
  InspectorGridController,
  inspectorGridStyles,
} from '../../../components/grid/InspectorGridController.js';
import {
  dispatchInspectorLocate,
  dispatchInspectorReveal,
} from '../../../components/inspectorReveal.js';
import { TeardownController } from '#core/events/TeardownController.js';
import { describeLevelGap } from '#core/log/levelCapabilities.js';
import { logContext } from '#core/log/logContext.js';
import type { LogStore } from '#core/log/LogStore.js';
import { sum, type GridColumn, type TreeSource } from '../../../grid/index.js';
import { globalStyles } from '../../../styles/global.styles.js';
import {
  type DatabaseCallNode,
  databaseOverview,
  NO_STATEMENTS,
  type StatementKind,
} from '../services/databaseOverview.js';

/** One row of the database call tree. */
export interface DatabaseTreeRow {
  id: number;
  label: string;
  /** Set when the row is the statement itself, not a frame that led to one. */
  kind: StatementKind | null;
  /** Database time beneath the row (ns) — for a statement, its whole duration. */
  timeNs: number;
  /** The code's own time (ns): the row's frames, each less the children it ran. */
  selfNs: number;
  count: number;
  eventIds: number[];
  _children: DatabaseTreeRow[] | null;
}

/** The tree as grid rows, ids assigned depth first. */
export function databaseTreeRows(tree: readonly DatabaseCallNode[]): DatabaseTreeRow[] {
  let nextId = 0;
  const map = (nodes: readonly DatabaseCallNode[]): DatabaseTreeRow[] =>
    nodes.map((node) => ({
      id: nextId++,
      label: node.label,
      kind: node.kind,
      timeNs: node.timeNs,
      selfNs: node.selfNs,
      count: node.count,
      eventIds: node.eventIds,
      _children: node.children.length ? map(node.children) : null,
    }));
  return map(tree);
}

/**
 * Where the database time was spent, as the call paths that reach it: only the
 * branches that end in a query, a DML or a search, each carrying the database
 * time beneath it. The grids name the statements; this names the code that ran
 * them, which is what a fix has to change.
 *
 * Two figures that never overlap: total time is the database time beneath the
 * row, each statement counted once however deep it nests, and self time is the
 * row's own code with every child excluded. A path whose total is database time
 * and whose self time is near zero is waiting on the database; the reverse is
 * Apex around it. The grids beside sum each statement's whole duration, so a
 * query inside a DML trigger is in both their totals and theirs read higher.
 */
@customElement('database-time')
export class DatabaseTime extends LitElement {
  // The store whose rows the grid holds; the skeleton shows until it is the one on screen.
  @state()
  private _builtFor: LogStore | null = null;
  @state()
  private _source: TreeSource<DatabaseTreeRow> | null = null;
  @state()
  private _columns: GridColumn<DatabaseTreeRow>[] = [];

  // The log on screen, from the app root.
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private readonly _grid = createRef<AppGrid<DatabaseTreeRow>>();

  // Built on the first mark: only a pointer in the grid beside needs it.
  private _rowsByEvent: Map<number, number[]> | null = null;
  // A newer build aborts it, and so does a teardown.
  private _building: AbortController | null = null;

  private readonly _inspector = new InspectorGridController<DatabaseTreeRow>(this, {
    grid: () => this._grid.value ?? null,
    source: () => this._source,
    frames: (row) => row.eventIds,
    // A frame or a merged row has no one statement to reveal, so its pick holds a mark on all of them.
    pick: (row) => {
      const eventId = revealable(row);
      if (eventId !== null) {
        dispatchInspectorReveal(this, eventId);
      } else {
        dispatchInspectorLocate(this, row?.eventIds ?? [], true);
      }
    },
    menuFrame: (row) => row.eventIds[0] ?? null,
    keysFor: (eventIds) => this._rowIdsFor(eventIds),
    dropOnClear: true,
  });

  private readonly _teardown = new TeardownController(this, {
    teardown: () => {
      this._building?.abort();
      this._source = null;
      this._rowsByEvent = null;
      this._builtFor = null;
    },
    rebuild: () => void this._build(),
  });

  static styles = [globalStyles, inspectorGridStyles];

  updated(changed: PropertyValues): void {
    if (changed.has('logStore')) {
      void this._build();
    }
  }

  render() {
    return html`
      <grid-skeleton ?pending=${this._builtFor !== this.logStore}></grid-skeleton>
      <lv-app-grid
        ${ref(this._grid)}
        .label=${'Database call tree'}
        .placeholder=${describeLevelGap(this.logStore?.levelGap('queries'), NO_STATEMENTS)}
        .source=${this._source}
        .columns=${this._columns}
        .marked=${this._inspector.marked}
      ></lv-app-grid>
      ${this._inspector.menu()}
    `;
  }

  // One frame names several rows.
  private _rowIdsFor(eventIds: readonly number[]): number[] {
    const byEvent = (this._rowsByEvent ??= rowIdsByEventId(this._source?.roots ?? []));
    return eventIds.flatMap((eventId) => byEvent.get(eventId) ?? []);
  }

  private async _build(): Promise<void> {
    const store = this.logStore;
    this._building?.abort();
    const { signal } = (this._building = new AbortController());
    if (this._source?.roots.length) {
      // The last log's rows: a hover on them while this one derives would locate in the wrong log.
      this._setRows([]);
    }
    const overview = store && (await store.derive(databaseOverview));
    if (signal.aborted) {
      return;
    }
    const rows = overview ? databaseTreeRows(overview.tree) : [];
    this._columns = databaseColumns(overview?.time.timeNs ?? 0, ownCodeTotal(rows));
    this._setRows(rows);
    this._builtFor = store;
  }

  private _setRows(rows: readonly DatabaseTreeRow[]): void {
    this._rowsByEvent = null;
    this._source = { roots: rows, children: (row) => row._children, key: (row) => row.id };
  }
}

// Own code is a share of its own total: it is Apex, which the database time does not bound.
function databaseColumns(timeNs: number, ownCodeNs: number): GridColumn<DatabaseTreeRow>[] {
  return [
    inlineQueryColumn({
      id: 'label',
      title: 'Name',
      value: (row) => row.label,
      dialect: (row) => (row.kind === 'SOQL' ? 'soql' : row.kind === 'SOSL' ? 'sosl' : null),
    }),
    timeColumn({
      id: 'timeNs',
      title: 'Total Time',
      value: (row) => row.timeNs,
      totalNs: timeNs,
      calc: sum((row) => row.timeNs),
    }),
    // Every row, child rows included: no row's own code overlaps another's.
    timeColumn({
      id: 'selfNs',
      title: 'Self Time',
      value: (row) => row.selfNs,
      totalNs: ownCodeNs,
      calc: { of: () => ownCodeNs },
    }),
    countColumn({
      id: 'count',
      title: 'Calls',
      value: (row) => row.count,
      summed: false,
    }),
  ];
}

/** Own code across the whole tree, every row counted once. */
export function ownCodeTotal(rows: readonly DatabaseTreeRow[]): number {
  let total = 0;
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!; // non-empty: the loop condition just checked
    total += row.selfNs;
    for (const child of row._children ?? []) {
      stack.push(child);
    }
  }
  return total;
}

/** The statement a row reveals, or null when it is a frame or merges several. */
function revealable(row: DatabaseTreeRow | null): number | null {
  return row?.kind && row.eventIds.length === 1 ? (row.eventIds[0] ?? null) : null;
}

/** The rows keyed by each occurrence they stand for. */
function rowIdsByEventId(rows: readonly DatabaseTreeRow[]): Map<number, number[]> {
  const byEvent = new Map<number, number[]>();
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!; // non-empty: the loop condition just checked
    for (const eventId of row.eventIds) {
      const ids = byEvent.get(eventId);
      if (ids) {
        ids.push(row.id);
      } else {
        byEvent.set(eventId, [row.id]);
      }
    }
    for (const child of row._children ?? []) {
      stack.push(child);
    }
  }
  return byEvent;
}

declare global {
  interface HTMLElementTagNameMap {
    'database-time': DatabaseTime;
  }
}
