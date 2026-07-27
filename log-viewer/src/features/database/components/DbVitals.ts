/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DMLBeginLine, SOQLExecuteBeginLine, SOSLExecuteBeginLine } from 'apex-log-parser';
import { formatMs } from '../../../core/utility/Duration.js';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { DatabaseAccess } from '../services/Database.js';
import { panelTokens } from '../../../components/panelTokens.js';
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/CodeBlock.js';

/** Compact "vitals" readout for the selected DML/SOQL/SOSL statement. */
@customElement('db-vitals')
export class DbVitals extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  @property({ type: String })
  type: 'dml' | 'soql' | 'sosl' = 'soql';

  static styles = [
    globalStyles,
    panelTokens,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      code-block {
        margin-bottom: var(--space-2);
      }
      /* Each pair stacks (label above value) by default so a narrow dock never
         scrolls or crushes the value; it relays out to two columns
         (label | value) once there's room. The grid owns the columns and each
         row uses subgrid so every label/value lines up across rows. */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-2) var(--space-3);
      }
      .row {
        display: grid;
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        row-gap: 2px;
      }
      @container (min-width: 240px) {
        .grid {
          grid-template-columns: max-content minmax(0, 1fr);
        }
        .row {
          align-items: baseline;
        }
      }
      .label {
        color: var(--vscode-descriptionForeground);
      }
      .value {
        font-family: var(--vscode-editor-font-family, monospace);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .pill {
        display: inline-block;
        padding: 0 var(--space-2);
        border-radius: var(--panel-radius);
        font-size: 0.85em;
        line-height: 1.4;
        color: var(--vscode-editor-background);
      }
      .pill--yes {
        background-color: var(--vscode-charts-green, #388a34);
      }
      .pill--no {
        background-color: var(--vscode-charts-red, #d13438);
      }
      .empty {
        color: var(--vscode-descriptionForeground);
      }
    `,
  ];

  render() {
    const line = DatabaseAccess.instance()?.getEventByIndex(this.eventIndex) ?? null;
    if (!line) {
      return html`<div class="empty">No details available.</div>`;
    }
    if (this.type === 'soql' && line instanceof SOQLExecuteBeginLine) {
      return this._renderSoql(line);
    }
    if (this.type === 'sosl' && line instanceof SOSLExecuteBeginLine) {
      return this._renderSimple(line, line.soslRowCount.total);
    }
    if (line instanceof DMLBeginLine) {
      return this._renderSimple(line, line.dmlRowCount.total);
    }
    return html`<div class="empty">No details available.</div>`;
  }

  /** DML and SOSL share the same vitals (Rows/Time/Namespace/Caller/Line);
   *  only the row-count source differs. */
  private _renderSimple(line: DMLBeginLine | SOSLExecuteBeginLine, rowCount: number | undefined) {
    const rows: TemplateResult[] = [];
    this._row(rows, 'Rows', rowCount ?? '—');
    this._row(rows, 'Time', `${formatMs(line.duration.total)} ms`);
    this._row(rows, 'Namespace', line.namespace || '—');
    this._row(rows, 'Caller namespace', getCallerNamespace(line));
    this._row(rows, 'Line', line.lineNumber ?? '—');

    return html`
      <code-block language="plain" .code=${line.text}></code-block>
      <div class="grid">${rows}</div>
    `;
  }

  private _renderSoql(line: SOQLExecuteBeginLine) {
    const explain = line.children[0];
    const rows: TemplateResult[] = [];
    this._row(rows, 'Rows', line.soqlRowCount.total ?? '—');
    this._row(rows, 'Time', `${formatMs(line.duration.total)} ms`);
    this._row(rows, 'Namespace', line.namespace || '—');
    this._row(rows, 'Selective', this._selectivityPill(explain?.relativeCost ?? null));
    if (explain) {
      if (explain.sObjectType) {
        this._row(rows, 'Object', explain.sObjectType);
      }
      if (explain.leadingOperationType) {
        this._row(rows, 'Leading op', explain.leadingOperationType);
      }
      if (explain.fields?.length) {
        this._row(rows, 'Index', explain.fields.join(', '));
      }
      if (explain.cardinality !== null) {
        this._row(rows, 'Est. rows', explain.cardinality);
      }
      if (explain.sObjectCardinality !== null) {
        this._row(rows, 'Object rows', explain.sObjectCardinality);
      }
    }
    this._row(rows, 'Aggregations', line.aggregations ?? 0);
    this._row(rows, 'Line', line.lineNumber ?? '—');

    return html`
      <code-block language="soql" .code=${line.text}></code-block>
      <div class="grid">${rows}</div>
    `;
  }

  private _row(rows: TemplateResult[], label: string, value: unknown) {
    rows.push(
      html`<div class="row"
        ><span class="label">${label}</span><span class="value">${value}</span></div
      >`,
    );
  }

  private _selectivityPill(relativeCost: number | null) {
    if (relativeCost === null || relativeCost === undefined) {
      return html`<span class="value">Unknown</span>`;
    }
    const cost = html` (cost ${relativeCost})`;
    return relativeCost <= 1
      ? html`<span class="pill pill--yes">Selective</span>${cost}`
      : html`<span class="pill pill--no">Not selective</span>${cost}`;
  }
}
