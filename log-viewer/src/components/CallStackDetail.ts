/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { type CellComponent, type RowComponent, Tabulator } from 'tabulator-tables';

import {
  commonColumnDefaults,
  createDurationBarColumn,
  headerSortElement,
  clipboardCopyOptions,
  registerTableModules,
} from '../features/call-tree/components/TableShared.js';
import { soqlInlineElement } from '../features/soql/format/inlineCell.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { eventBus } from '../core/events/EventBus.js';
import { SelectionEchoGuard } from '../core/events/SelectionEchoGuard.js';
import { LocatedRowMarker, rowIndexStamper } from './locatedRow.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressColumnWidth } from '../tabulator/format/measureWidth.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import { buildCallStackData, type CallStackRow } from './callStackData.js';
import './ContextMenu.js';
import type { ContextMenu } from './ContextMenu.js';
import { dispatchInspectorLocate, dispatchInspectorReveal } from './inspectorReveal.js';
import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from './panelRowMenu.js';

/**
 * The lineage of parent frames that led to an event, outermost first, as a
 * small resizable table (Frame | Total | Self) that mirrors the Call Tree —
 * same `progressFormatterMS` bars (percent of the stack's root frame), column
 * headers, resizable columns.
 *
 * The list is anchored: `eventIndex` is the frame the stack was built for and
 * never moves while the user walks it. Clicking a frame makes it the active one
 * — the row the rest of the inspector follows — which the inspector feeds back
 * as `activeEventIndex`, so no frame is lost on the way down.
 */
@customElement('call-stack-detail')
export class CallStackDetail extends LitElement {
  /** The frame the stack was built for; the list stays anchored to it. */
  @property({ type: Number })
  eventIndex = -1;

  /** The frame in the stack the inspector is following. */
  @property({ type: Number })
  activeEventIndex = -1;

  private _table: Tabulator | null = null;
  /** Guards the select made to mark the active frame. */
  private _echoGuard = new SelectionEchoGuard();
  /** Marks the row for the frame under the pointer in the tab's own view. */
  private _locatedRow = new LocatedRowMarker();
  private _locateUnsubscribe?: () => void;
  private _contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private _menuEventIndex = -1;

  firstUpdated(): void {
    this._contextMenu = this.renderRoot.querySelector('context-menu');
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._locateUnsubscribe = eventBus.on('detail:locate', ({ eventIndexes }) => {
      this._locatedRow.mark(this._tableHost(), eventIndexes);
    });
  }

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
      #call-stack-table {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
      }
      /* Right-align the value block so the tabular-nums digits line up. */
      #call-stack-table .progress-wrapper {
        display: flex;
        justify-content: flex-end;
      }
      /* Frame: single line, ellipsis — never wrap. */
      #call-stack-table .tabulator-cell.truncate {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];

  updated(changed: PropertyValues) {
    if (changed.has('eventIndex')) {
      this._rebuild();
    } else if (changed.has('activeEventIndex')) {
      // The anchor holds, so the rows are unchanged — only the mark moves.
      this._markActive();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._locateUnsubscribe?.();
    this._locateUnsubscribe = undefined;
    this._locatedRow.clear();
    this._table?.destroy();
    this._table = null;
  }

  private _tableHost(): HTMLElement | null {
    return this.renderRoot?.querySelector<HTMLElement>('#call-stack-table') ?? null;
  }

  private _rebuild() {
    const container = this._tableHost();
    if (!container) {
      return;
    }
    // The table about to be destroyed can't report the pointer leaving its rows,
    // so any mark it asked for is dropped here.
    if (this._table) {
      dispatchInspectorLocate(this, []);
    }
    // Rows of the old table go with it, so the mark can't outlive them.
    this._locatedRow.clear();
    // Percentages are relative to this stack's root frame, so totalValue changes
    // per selection — rebuild rather than setData to refresh the column params.
    this._table?.destroy();

    const { rows, rootTotal } = buildCallStackData(this.eventIndex);
    const barParams = { precision: 2, totalValue: rootTotal };
    const barWidth = progressColumnWidth(rootTotal);
    registerTableModules();
    this._table = new Tabulator(container, {
      index: 'eventIndex',
      data: rows,
      height: '100%',
      layout: 'fitColumns',
      placeholder: 'No call stack available',
      columnCalcs: 'table',
      // Arrow-key row navigation, matching the Call Tree tab.
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      // Lets the hover mark find a row by one DOM query.
      rowFormatter: rowIndexStamper('eventIndex'),
      ...clipboardCopyOptions,
      headerSortElement,
      columnDefaults: commonColumnDefaults,
      columns: [
        {
          title: 'Frame',
          field: 'text',
          // Frame absorbs the slack and shrinks + truncates first; the time
          // columns hold a fixed content width. Below Frame's minWidth the table
          // scrolls horizontally, like the main Call Tree tab.
          sorter: 'string',
          widthGrow: 1,
          widthShrink: 1,
          minWidth: 140,
          cssClass: 'datagrid-code-text truncate',
          tooltip: true,
          formatter: frameFormatter,
          bottomCalc: () => 'Total',
        },
        // The outermost frame's total (= the stack root); a plain sum would
        // double-count the nested chain, so Total uses 'max'.
        createDurationBarColumn({
          title: 'Total (ms)',
          field: 'duration.total',
          barWidth,
          barParams,
          bottomCalc: 'max',
        }),
        createDurationBarColumn({
          title: 'Self (ms)',
          field: 'duration.self',
          barWidth,
          barParams,
          bottomCalc: 'sum',
        }),
      ],
    });
    // No rowClick navigation: clicking a frame only selects it
    // (RowKeyboardNavigation) — jumping to the main Call Tree tab is an explicit
    // right-click action. The call stack is flat, so there is nothing to toggle.
    this._table.on('rowContext', (e, row) => {
      this._showRowMenu(e as MouseEvent, row);
    });
    // Selecting a frame makes it the active one and reveals it in the tab on
    // screen; the inspector adds the source, since only it knows which tab that
    // is. The mark this table sets itself is not a pick, so it is guarded.
    this._table.on('rowSelectionChanged', (_data, rows) => {
      if (this._echoGuard.suppressed) {
        return;
      }
      const eventIndex = (rows[0]?.getData() as CallStackRow | undefined)?.eventIndex;
      if (eventIndex !== undefined) {
        dispatchInspectorReveal(this, eventIndex);
      }
    });
    // Hovering a frame marks it in the tab on screen, so the user can see where
    // it sits before deciding to pick it.
    this._table.on('rowMouseEnter', (_e, row) => {
      const eventIndex = (row.getData() as CallStackRow).eventIndex;
      if (eventIndex !== undefined) {
        dispatchInspectorLocate(this, [eventIndex]);
      }
    });
    this._table.on('rowMouseLeave', () => {
      dispatchInspectorLocate(this, []);
    });
    this._table.on('tableBuilt', () => {
      this._markActive();
    });
  }

  /** Marks the active frame in the list, without reporting it as a new pick. */
  private _markActive(): void {
    const table = this._table;
    if (!table) {
      return;
    }
    this._echoGuard.run(() => {
      for (const selected of table.getSelectedRows()) {
        selected.deselect();
      }
      if (this.activeEventIndex >= 0) {
        table.selectRow([this.activeEventIndex]);
      }
    });
  }

  /** Row right-click menu: reveal in the Call Tree tab, or copy the frame. */
  private _showRowMenu(event: MouseEvent, row: RowComponent) {
    if (!this._contextMenu || window.getSelection()?.type === 'Range') {
      return;
    }
    event.preventDefault();

    for (const selected of this._table?.getSelectedRows() ?? []) {
      selected.deselect();
    }
    row.select();

    const { eventIndex } = row.getData() as CallStackRow;
    this._menuEventIndex = eventIndex;
    this._contextMenu.show(PANEL_ROW_MENU_ITEMS, event.clientX, event.clientY);
  }

  render() {
    return html`<div id="call-stack-table"></div>
      <context-menu
        @menu-select=${(e: CustomEvent<{ itemId: string }>) =>
          runPanelRowAction(e.detail.itemId, this._menuEventIndex)}
      ></context-menu>`;
  }
}

function frameFormatter(cell: CellComponent): HTMLElement | string {
  const data = cell.getData() as CallStackRow;
  const isSoql = data.type === 'SOQL_EXECUTE_BEGIN';
  const isSosl = data.type === 'SOSL_EXECUTE_BEGIN';
  if ((isSoql || isSosl) && data.text) {
    return soqlInlineElement(data.text, isSosl ? 'sosl' : 'soql');
  }
  return data.text ?? '';
}
