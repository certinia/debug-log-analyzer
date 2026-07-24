/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DMLBeginLine, SOQLExecuteBeginLine } from 'apex-log-parser';
import { formatMs } from '../../../core/utility/Duration.js';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { DatabaseAccess } from '../services/Database.js';
import { panelTokens } from '../../../components/panelTokens.js';
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/CodeBlock.js';

/** Compact "vitals" readout for the selected DML/SOQL statement. */
@customElement('db-vitals')
export class DbVitals extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  @property({ type: String })
  type: 'dml' | 'soql' = 'soql';

  static styles = [
    globalStyles,
    panelTokens,
    css`
      :host {
        display: block;
      }
      code-block {
        margin-bottom: var(--space-2);
      }
      .grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--space-1) var(--space-3);
        align-items: baseline;
      }
      .label {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
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
    return this.type === 'soql' && line instanceof SOQLExecuteBeginLine
      ? this._renderSoql(line)
      : line instanceof DMLBeginLine
        ? this._renderDml(line)
        : html`<div class="empty">No details available.</div>`;
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

  private _renderDml(line: DMLBeginLine) {
    const rows: TemplateResult[] = [];
    this._row(rows, 'Rows', line.dmlRowCount.total ?? '—');
    this._row(rows, 'Time', `${formatMs(line.duration.total)} ms`);
    this._row(rows, 'Namespace', line.namespace || '—');
    this._row(rows, 'Caller namespace', getCallerNamespace(line));
    this._row(rows, 'Line', line.lineNumber ?? '—');

    return html`
      <code-block language="plain" .code=${line.text}></code-block>
      <div class="grid">${rows}</div>
    `;
  }

  private _row(rows: TemplateResult[], label: string, value: unknown) {
    rows.push(html`<span class="label">${label}</span><span class="value">${value}</span>`);
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
