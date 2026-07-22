/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../../../styles/global.styles.js';

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** A single database limit metric: what the tables tracked vs what the limit is. */
export interface DatabaseMetric {
  /** Metric name, e.g. `Statements`, `Rows`, `Searches`. */
  label: string;
  /** Count seen in the log and shown in the table. */
  found: number;
  /** The governor-consumed total, or `null` when cumulative limits weren't logged. */
  used: number | null;
  /** The governor limit (0 when none applies / unknown). */
  limit: number;
  /**
   * Overrides the default seen-vs-used reconciliation tooltip. Set when the limit
   * is a derived ceiling that needs explaining (e.g. SOSL rows: 2,000/query × 20).
   */
  note?: string;
}

/** Fill tier: safe under 80%, warning from 80%, danger at or over 100%. */
function tier(percent: number): 'safe' | 'warn' | 'danger' {
  if (percent >= 100) {
    return 'danger';
  }
  return percent >= 80 ? 'warn' : 'safe';
}

/**
 * One database limit metric as a small stacked stat: a `LABEL  N seen · used /
 * limit` line over a thin full-width bar. Shares the section header's language
 * (no box or fill). Two states:
 * - known → `used / limit` + proportional bar (tooltip: {@link DatabaseMetric.note}
 *   if set, else the seen-vs-used reconciliation);
 * - unknown → `limit n/a` + empty bar, whole stat muted (never a guess).
 */
@customElement('database-metric-card')
export class DatabaseMetricCard extends LitElement {
  @property({ attribute: false })
  metric: DatabaseMetric | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        display: inline-flex;
      }

      .stat {
        display: inline-flex;
        flex-direction: column;
        gap: 4px;
        min-width: 8rem;
      }

      /* Unknown limit (no cumulative usage in the log): de-emphasised so an
         empty bar reads as "no data", not "0%". */
      .stat.unknown {
        opacity: 0.6;
      }

      .stat__line {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
        font-size: 0.85rem;
      }

      .stat__label {
        font-size: 0.72rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }

      .stat__seen {
        font-family: var(--vscode-editor-font-family, monospace);
        font-variant-numeric: tabular-nums;
      }

      .stat__used {
        font-family: var(--vscode-editor-font-family, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.8rem;
        color: var(--vscode-descriptionForeground);
      }

      .stat__used.na {
        font-style: italic;
      }

      .stat__sep {
        color: var(--vscode-descriptionForeground);
      }

      .stat__track {
        display: block;
        width: 100%;
        height: 3px;
        border-radius: 2px;
        background: var(--vscode-editorWidget-border, var(--vscode-panel-border));
        overflow: hidden;
      }

      .stat__fill {
        display: block;
        height: 100%;
        border-radius: 2px;
        transition: width 150ms ease;
      }

      .stat__fill--safe {
        background: var(--vscode-charts-green, #388a34);
      }
      .stat__fill--warn {
        background: var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground));
      }
      .stat__fill--danger {
        background: var(--vscode-errorForeground, #f14c4c);
      }

      @media (prefers-reduced-motion: reduce) {
        .stat__fill {
          transition: none;
        }
      }
    `,
  ];

  render() {
    const metric = this.metric;
    if (!metric) {
      return nothing;
    }

    const unknown = metric.used === null && metric.limit <= 0;
    return html`<span class="stat ${unknown ? 'unknown' : ''}">
      <span class="stat__line">
        <span class="stat__label">${metric.label}</span>
        <span class="stat__seen">${integer.format(metric.found)} seen</span>
        <span class="stat__sep">·</span>
        ${this._renderConsumed(metric)}
      </span>
      ${this._renderBar(metric)}
    </span>`;
  }

  private _renderConsumed(metric: DatabaseMetric) {
    if (metric.used === null) {
      return html`<span
        class="stat__used na"
        title="The consumed figure needs cumulative limit usage in the log — raise the database log level to FINE or above."
        >limit n/a</span
      >`;
    }

    const delta = metric.found - metric.used;
    const title =
      metric.note ??
      (delta > 0
        ? `${delta} seen but not counted toward the limit (e.g. custom metadata).`
        : delta < 0
          ? `${-delta} counted by Salesforce but not emitted as log lines (e.g. managed-package internals).`
          : 'Every statement seen counted toward the limit.');
    return html`<span class="stat__used" title="${title}"
      >${integer.format(metric.used)} / ${integer.format(metric.limit)} used</span
    >`;
  }

  private _renderBar(metric: DatabaseMetric) {
    // The track always renders — even when the limit is unknown, where it stays
    // empty — so every metric block is the same height and their text lines up.
    const hasFill = metric.used !== null && metric.limit > 0;
    const percent = hasFill && metric.used !== null ? (metric.used / metric.limit) * 100 : 0;
    return html`<span class="stat__track"
      >${
        hasFill
          ? html`<span
              class="stat__fill stat__fill--${tier(percent)}"
              style="width: ${Math.min(percent, 100)}%"
            ></span>`
          : nothing
      }</span
    >`;
  }
}
