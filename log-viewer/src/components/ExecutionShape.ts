/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

import { eventBus } from '../core/events/EventBus.js';
import { formatInteger } from '../core/utility/Util.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import {
  computeExecutionShapeStats,
  type ExecutionShapeStats,
} from '../features/call-tree/utils/ExecutionShapeStats.js';
import { globalStyles } from '../styles/global.styles.js';

/** Memo of the walk: the tree is built once per log, the tab re-opens often. */
const statsCache = new WeakMap<ApexLog, ExecutionShapeStats>();

/**
 * The Call Tree tab's whole-log section: the structure of the execution — how
 * deep, how wide, how much of it there is — which only this tab can answer.
 * Time questions belong to the Analysis tab and the flame chart, so no
 * durations appear here.
 */
@customElement('execution-shape')
export class ExecutionShape extends LitElement {
  private _offLogLoaded: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    // The inspector paints before the first log is parsed, and it rebuilds only
    // on a tab change or a selection — so the stats have to follow the log.
    this._offLogLoaded = eventBus.on('log:loaded', () => this.requestUpdate());
  }

  override disconnectedCallback() {
    this._offLogLoaded?.();
    this._offLogLoaded = null;
    super.disconnectedCallback();
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
        padding: var(--lana-space-sm) var(--lana-space-md) var(--lana-space-md)
          var(--lana-section-inset);
      }
      /* Label/value pairs stack when narrow and become two aligned columns when
         there's room; the grid owns the columns so subgrid rows line up. */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--lana-space-sm) var(--lana-space-md);
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
      .qualifier {
        color: var(--vscode-descriptionForeground);
        font-size: var(--lana-text-sm);
      }
      .empty {
        color: var(--vscode-descriptionForeground);
      }
    `,
  ];

  render() {
    const stats = this._stats();
    if (!stats || stats.eventCount === 0) {
      return html`<div class="empty">No events to measure.</div>`;
    }

    const rows: TemplateResult[] = [
      this._row('Events', formatInteger(stats.eventCount)),
      this._row(
        'Nodes',
        html`${formatInteger(stats.nodeCount)} <span class="qualifier">(details excluded)</span>`,
      ),
      this._row(
        'Depth',
        html`${formatInteger(stats.maxDepth)}
          <span class="qualifier">(mean ${stats.meanDepth.toFixed(1)})</span>`,
      ),
    ];
    if (stats.truncatedRegionCount > 0) {
      rows.push(this._row('Truncated calls', formatInteger(stats.truncatedRegionCount)));
    }
    if (stats.deepest) {
      rows.push(
        this._row(
          'Deepest call',
          html`${stats.deepest.text}
            <span class="qualifier">(depth ${formatInteger(stats.deepest.depth)})</span>`,
        ),
      );
    }
    if (stats.widest) {
      rows.push(
        this._row(
          'Widest point',
          html`${stats.widest.text ?? 'Log root'}
            <span class="qualifier">(${formatInteger(stats.widest.childCount)} children)</span>`,
        ),
      );
    }

    return html`<div class="grid">${rows}</div>`;
  }

  private _row(label: string, value: string | TemplateResult): TemplateResult {
    return html`<div class="row">
      <span class="label">${label}</span>
      <span class="value">${value}</span>
    </div>`;
  }

  private _stats(): ExecutionShapeStats | null {
    const apexLog = DatabaseAccess.instance()?.getApexLog();
    if (!apexLog) {
      return null;
    }
    let stats = statsCache.get(apexLog);
    if (!stats) {
      stats = computeExecutionShapeStats(apexLog.children);
      statsCache.set(apexLog, stats);
    }
    return stats;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'execution-shape': ExecutionShape;
  }
}
