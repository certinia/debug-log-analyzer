/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { type CellComponent, Tabulator } from 'tabulator-tables';

import {
  headerSortElement,
  registerTableModules,
} from '../features/call-tree/components/TableShared.js';
import { formatSOQL } from '../features/soql/format/formatter.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressFormatterMS } from '../tabulator/format/ProgressMS.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import { buildCallStackData, type CallStackRow } from './callStackData.js';

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
    registerTableModules();
    this._table = new Tabulator(container, {
      index: 'eventIndex',
      data: rows,
      height: '100%',
      layout: 'fitColumns',
      placeholder: 'No call stack available',
      columnCalcs: false,
      // Arrow-key row navigation, matching the Call Tree tab.
      // @ts-expect-error custom option registered by the RowKeyboardNavigation module (types not updated)
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      headerSortElement,
      columnDefaults: {
        resizable: true,
        headerTooltip: true,
        headerSortStartingDir: 'desc',
      },
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
          cssClass: 'truncate',
          tooltip: true,
          formatter: frameFormatter,
        },
        {
          title: 'Total (ms)',
          field: 'duration.total',
          sorter: 'number',
          width: 150,
          minWidth: 150,
          widthGrow: 0,
          widthShrink: 0,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: progressFormatterMS,
          formatterParams: { precision: 2, totalValue: rootTotal },
        },
        {
          title: 'Self (ms)',
          field: 'duration.self',
          sorter: 'number',
          width: 150,
          minWidth: 150,
          widthGrow: 0,
          widthShrink: 0,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: progressFormatterMS,
          formatterParams: { precision: 2, totalValue: rootTotal },
        },
      ],
    });
    // No rowClick navigation: clicking a frame selects it (RowKeyboardNavigation)
    // and never jumps to the main Call Tree tab. The call stack is flat, so there
    // is nothing to expand/collapse.
  }

  render() {
    return html`<div id="call-stack-table"></div>`;
  }
}

function frameFormatter(cell: CellComponent): HTMLElement | string {
  const data = cell.getData() as CallStackRow;
  const isSoql = data.type === 'SOQL_EXECUTE_BEGIN';
  const isSosl = data.type === 'SOSL_EXECUTE_BEGIN';
  if ((isSoql || isSosl) && data.text) {
    const span = document.createElement('span');
    span.className = 'soql-block soql-inline';
    span.innerHTML = formatSOQL(data.text, { mode: 'inline', dialect: isSosl ? 'sosl' : 'soql' });
    return span;
  }
  return data.text ?? '';
}
