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
  registerTableModules,
} from '../features/call-tree/components/TableShared.js';
import { soqlInlineElement } from '../features/soql/format/inlineCell.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressColumnWidth } from '../tabulator/format/measureWidth.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import { buildCallStackData, type CallStackRow } from './callStackData.js';
import './ContextMenu.js';
import type { ContextMenu } from './ContextMenu.js';
import { panelRowMenuItems, runPanelRowAction } from './panelRowMenu.js';

/**
 * The lineage of parent frames that led to an event, outermost first, as a
 * small resizable table (Frame | Total | Self) that mirrors the Call Tree —
 * same `progressFormatterMS` bars (percent of the stack's root frame), column
 * headers, resizable columns. Clicking a frame jumps to it.
 */
@customElement('call-stack-detail')
export class CallStackDetail extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  private _table: Tabulator | null = null;
  private _contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private _menuEventIndex = -1;

  firstUpdated(): void {
    this._contextMenu = this.renderRoot.querySelector('context-menu');
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
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._table?.destroy();
    this._table = null;
  }

  private _rebuild() {
    const container = this.renderRoot?.querySelector('#call-stack-table') as HTMLElement | null;
    if (!container) {
      return;
    }
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
      // Arrow-key row navigation, matching the Call Tree tab. Custom option
      // registered by the RowKeyboardNavigation module (absent from the types).
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      // Ctrl/Cmd+C copies the table, matching the main grids.
      clipboard: true,
      clipboardCopyRowRange: 'all',
      // @ts-expect-error types need update, an array of bindings is valid
      keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
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
    this._contextMenu.show(panelRowMenuItems(), event.clientX, event.clientY);
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
