/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import {
  type CellComponent,
  type ColumnDefinition,
  type RowComponent,
  Tabulator,
} from 'tabulator-tables';

import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import {
  dispatchInspectorLocate,
  dispatchInspectorReveal,
} from '../../../components/inspectorReveal.js';
import {
  LOCATED_ROW_CLASS,
  LocatedRowMarker,
  rowIndexStamper,
} from '../../../components/locatedRow.js';
import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from '../../../components/panelRowMenu.js';
import { eventBus } from '../../../core/events/EventBus.js';
import { logContext } from '../../../core/log/logContext.js';
import type { LogStore } from '../../../core/log/LogStore.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { formatDuration, formatInteger } from '../../../core/utility/Util.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { progressColumnWidth } from '../../../tabulator/format/measureWidth.js';
import type { ProgressParams } from '../../../tabulator/format/ProgressMS.js';
import dataGridStyles from '../../../tabulator/style/DataGrid.scss';
import {
  clipboardCopyOptions,
  commonColumnDefaults,
  createDurationBarColumn,
  headerSortElement,
  registerTableModules,
  virtualScrollOptions,
} from '../../call-tree/components/TableShared.js';
import { waitForNextFrame } from '../../../core/utility/FrameBudget.js';
import { soqlInlineElement } from '../../soql/format/inlineCell.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
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
  eventIndexes: number[];
  _children: DatabaseTreeRow[] | null;
}

/** The tree as Tabulator rows, ids assigned depth first. */
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
      eventIndexes: node.eventIndexes,
      _children: node.children.length ? map(node.children) : null,
    }));
  return map(tree);
}

/**
 * Tree indent + the label: a query or a search renders as single-line (inline)
 * SOQL, so it truncates cleanly; every other frame is plain text.
 */
function nameFormatter(cell: CellComponent): HTMLElement {
  const row = cell.getRow();
  // @ts-expect-error this.table is bound by tabulator but missing from the types
  const childIndent: number = this.table?.options?.dataTreeChildIndent ?? 9;
  // @ts-expect-error _row is private but is the only way to read the tree level
  const treeLevel: number = row._row.modules.dataTree?.index ?? 0;
  const treeIndent = treeLevel * childIndent;
  if (treeIndent) {
    cell.getElement().style.paddingLeft = `calc(${treeIndent + 4}px + var(--lana-group-indent, 0px))`;
  }

  const { label, kind } = cell.getData() as DatabaseTreeRow;
  if (kind === 'SOQL' || kind === 'SOSL') {
    return soqlInlineElement(label, kind === 'SOSL' ? 'sosl' : 'soql');
  }
  return document.createTextNode(label) as unknown as HTMLElement;
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
  private _table: Tabulator | null = null;
  private _contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private _menuEventIndex = -1;

  /** The self-time footer: every row's own code, child rows included, since a
   *  tree footer sums only the roots. No filters here, so all of it counts. */
  private _ownCodeTotalNs = 0;

  /** Total-time bars: a share of the database time. Retargeted per log. */
  private readonly _timeBarParams: ProgressParams = {
    precision: 2,
    totalValue: 0,
    showPercentageText: true,
  };

  /**
   * Own-code bars: a share of the own-code total, not of the database time. A
   * frame's own code is Apex, which the database total does not bound, so sharing
   * one denominator lets a compute-heavy frame read past 100%.
   */
  private readonly _selfBarParams: ProgressParams = {
    precision: 2,
    totalValue: 0,
    showPercentageText: true,
  };

  /** Guards the mark this component sets itself, so it is never read as a pick. */
  private _echoGuard = new SelectionEchoGuard();

  /** Marks the row for the statement under the pointer in the grid beside. */
  private _locatedRow = new LocatedRowMarker();
  private _locateUnsubscribe?: () => void;
  private _selectionClearUnsubscribe?: () => void;

  /** eventIndex to the ids of the rows that name it, built on the first mark. */
  private _rowsByEvent: Map<number, number[]> | null = null;
  /** The rows the table was filled with. Never read them back with `getData()`:
   *  that runs Tabulator's accessors, which deep-clone every row. */
  private _rows: readonly DatabaseTreeRow[] = [];

  /** The build in flight; a newer one aborts it, and so does a disconnect. */
  private _building: AbortController | null = null;

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    globalStyles,
    unsafeCSS(dataGridStyles),
    unsafeCSS(soqlSyntaxStyles),
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      /* Tabulator mounts into this inner div, whose class Lit never rewrites.
         Binding a class on the mount element itself would clobber the tabulator
         classes Tabulator adds imperatively on every re-render, breaking the
         header layout. */
      .grid {
        flex: 1 1 auto;
        min-height: 0;
      }
      /* Name: single line, ellipsis — never wrap. */
      .tabulator-cell.truncate {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The statement under the pointer in the grid beside. */
      .tabulator-row.${unsafeCSS(LOCATED_ROW_CLASS)} {
        background-color: var(--lana-row-hover-bg);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    this._locateUnsubscribe = eventBus.on('detail:locate', ({ eventIndexes }) => {
      this._locatedRow.mark(this._host(), this._rowIdsFor(eventIndexes));
    });
    // Escape clears the tab's selection; a picked row here is no selection of
    // the grid, so this table drops its own.
    this._selectionClearUnsubscribe = eventBus.on('selection:clear', () => {
      this._dropPick();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._locateUnsubscribe?.();
    this._locateUnsubscribe = undefined;
    this._selectionClearUnsubscribe?.();
    this._selectionClearUnsubscribe = undefined;
    this._building?.abort();
    // Rows go with the table, so the mark can't outlive them.
    this._locatedRow.clear();
    this._table?.destroy();
    this._table = null;
    this._rowsByEvent = null;
    this._rows = [];
  }

  firstUpdated(): void {
    this._contextMenu = this.renderRoot.querySelector('context-menu');
  }

  updated(changed: PropertyValues): void {
    if (changed.has('logStore')) {
      void this._build();
    }
  }

  render() {
    return html`
      <div class="grid"></div>
      <context-menu
        @menu-select=${(e: CustomEvent<{ itemId: string }>) =>
          runPanelRowAction(e.detail.itemId, this._menuEventIndex)}
      ></context-menu>
    `;
  }

  private _host(): HTMLDivElement | null {
    return this.renderRoot?.querySelector<HTMLDivElement>('.grid') ?? null;
  }

  /** The ids of the rows that name `eventIndexes`; one frame names several. */
  private _rowIdsFor(eventIndexes: readonly number[]): number[] {
    if (!eventIndexes.length || !this._rows.length) {
      return [];
    }
    const byEvent = (this._rowsByEvent ??= rowIdsByEventIndex(this._rows));
    const ids = new Set<number>();
    for (const eventIndex of eventIndexes) {
      for (const id of byEvent.get(eventIndex) ?? []) {
        ids.add(id);
      }
    }
    return [...ids];
  }

  /** Drops a picked row, and the mark it holds in the grid beside. */
  private _dropPick(): void {
    const selected = this._table?.getSelectedRows() ?? [];
    if (!selected.length) {
      return;
    }
    this._echoGuard.run(() => {
      for (const row of selected) {
        row.deselect();
      }
    });
    dispatchInspectorLocate(this, [], true);
  }

  private async _build(): Promise<void> {
    const log = this.logStore?.log;
    const overview = log && databaseOverview(log);
    this._building?.abort();
    const { signal } = (this._building = new AbortController());
    // Wait for the host to lay out before Tabulator measures column widths —
    // building against a zero-width host makes the columns overlap.
    await this.updateComplete;
    await waitForNextFrame();
    const container = this._host();
    if (!container || signal.aborted) {
      return;
    }

    const rows = overview ? databaseTreeRows(overview.tree) : [];
    this._ownCodeTotalNs = ownCodeTotal(rows);
    // Each column is a share of its own footer, so both read 100% there.
    this._timeBarParams.totalValue = overview?.time.timeNs ?? 0;
    this._selfBarParams.totalValue = this._ownCodeTotalNs;
    this._rowsByEvent = null;
    this._rows = rows;

    if (this._table) {
      void this._table.setData(rows);
      return;
    }
    if (!overview) {
      // No log yet, so there is nothing to size a new table against.
      return;
    }

    registerTableModules();
    const table = new Tabulator(container, {
      data: rows,
      index: 'id',
      layout: 'fitColumns',
      height: '100%',
      maxHeight: '100%',
      placeholder: NO_STATEMENTS,
      ...virtualScrollOptions,
      dataTree: true,
      dataTreeChildField: '_children',
      dataTreeChildColumnCalcs: false,
      dataTreeBranchElement: '<span/>',
      columnCalcs: 'table',
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      // Lets the hover mark find a row by one DOM query.
      rowFormatter: rowIndexStamper('id'),
      ...clipboardCopyOptions,
      headerSortElement,
      columnDefaults: commonColumnDefaults,
      columns: this._columns(progressColumnWidth(overview.time.logNs)),
    });
    table.on('rowContext', (e, row) => {
      this._showRowMenu(e as MouseEvent, row, table);
    });
    // A statement row is one frame, so picking it reveals it in the grid; a
    // merged row and a frame have no one statement to jump to, so the pick marks
    // every occurrence instead and holds until it is dropped.
    table.on('rowSelectionChanged', (_data, rows) => {
      if (this._echoGuard.suppressed) {
        return;
      }
      const row = rows[0]?.getData() as DatabaseTreeRow | undefined;
      const eventIndex = revealable(row);
      if (eventIndex !== null) {
        dispatchInspectorReveal(this, eventIndex);
      } else {
        dispatchInspectorLocate(this, row?.eventIndexes ?? [], true);
      }
    });
    table.on('rowMouseEnter', (_e, row) => {
      dispatchInspectorLocate(this, (row.getData() as DatabaseTreeRow).eventIndexes);
    });
    table.on('rowMouseLeave', () => {
      dispatchInspectorLocate(this, []);
    });
    this._table = table;
  }

  /** Row right-click menu: reveal in the Call Tree tab, or copy the frame. */
  private _showRowMenu(event: MouseEvent, row: RowComponent, table: Tabulator): void {
    if (!this._contextMenu || window.getSelection()?.type === 'Range') {
      return;
    }
    event.preventDefault();

    for (const selected of table.getSelectedRows()) {
      selected.deselect();
    }
    row.select();

    const { eventIndexes } = row.getData() as DatabaseTreeRow;
    this._menuEventIndex = eventIndexes[0] ?? -1;
    if (this._menuEventIndex < 0) {
      return;
    }
    this._contextMenu.show(PANEL_ROW_MENU_ITEMS, event.clientX, event.clientY);
  }

  /**
   * `barWidth` is sized from the whole log, so the bar columns keep one width
   * whatever share of it the database holds.
   */
  private _columns(barWidth: number): ColumnDefinition[] {
    const self = createDurationBarColumn({
      title: 'Self Time',
      field: 'selfNs',
      barWidth,
      barParams: this._selfBarParams,
      bottomCalc: () => this._ownCodeTotalNs,
    });

    return [
      {
        title: 'Name',
        field: 'label',
        // Name absorbs the slack and truncates first; the numeric columns hold a
        // fixed content width.
        formatter: nameFormatter,
        cssClass: 'datagrid-code-text truncate',
        sorter: 'string',
        widthGrow: 1,
        widthShrink: 1,
        minWidth: 140,
        bottomCalc: () => 'Total',
      },
      createDurationBarColumn({
        title: 'Total Time',
        field: 'timeNs',
        barWidth,
        barParams: this._timeBarParams,
        bottomCalc: 'sum',
        tooltip: (_e, cell: CellComponent) => formatDuration(cell.getValue()),
      }),
      self,
      {
        title: 'Calls',
        field: 'count',
        sorter: 'number',
        hozAlign: 'right',
        headerHozAlign: 'right',
        width: 56,
        minWidth: 56,
        widthGrow: 0,
        widthShrink: 0,
        cssClass: 'number-cell',
        formatter: (cell: CellComponent) => formatInteger(cell.getValue()),
      },
    ];
  }
}

/** Own code across the whole tree — a Tabulator tree footer sums only roots. */
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
function revealable(row: DatabaseTreeRow | undefined): number | null {
  return row?.kind && row.eventIndexes.length === 1 ? (row.eventIndexes[0] ?? null) : null;
}

/** The rows keyed by each occurrence they stand for. */
function rowIdsByEventIndex(rows: readonly DatabaseTreeRow[]): Map<number, number[]> {
  const byEvent = new Map<number, number[]>();
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!; // non-empty: the loop condition just checked
    for (const eventIndex of row.eventIndexes) {
      const ids = byEvent.get(eventIndex);
      if (ids) {
        ids.push(row.id);
      } else {
        byEvent.set(eventIndex, [row.id]);
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
