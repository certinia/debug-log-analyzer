/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../../../styles/global.styles.js';

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** One at-a-glance governor gauge for the overview strip. */
export interface GaugeMetric {
  label: string;
  /** Count found in the log (fallback display when limits aren't available). */
  found: number;
  /** Governor-consumed count, or `null` when cumulative limits weren't logged. */
  used: number | null;
  /** Governor limit (0 when none applies). */
  limit: number;
  /**
   * How to write the numbers. Defaults to a thousand-separated integer; a byte
   * metric passes a compact one, since `5,400,000 / 6,000,000` is wider than a
   * gauge.
   */
  format?: (value: number) => string;
}

/** Consumption percentage where a gauge or trend turns from safe to warn. */
export const GOVERNOR_WARN_PERCENT = 80;

/** The severity colour band for a governor consumption percentage. */
export function governorTier(percent: number): 'safe' | 'warn' | 'danger' {
  if (percent >= 100) {
    return 'danger';
  }
  return percent >= GOVERNOR_WARN_PERCENT ? 'warn' : 'safe';
}

/**
 * The database overview strip: a single compact row of governor gauges
 * (`used / limit`) for an at-a-glance read across statement types. Fully
 * controlled — the host passes the metrics to show, already filtered and
 * ordered.
 */
@customElement('governor-summary')
export class GovernorSummary extends LitElement {
  @property({ attribute: false })
  metrics: GaugeMetric[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
      }

      .gauges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 22px;
        /* Left inset matches the sections' content edge (3px accent + 12px). */
        padding: 10px 12px 12px 15px;
      }

      .gauge {
        display: flex;
        flex-direction: column;
        gap: 4px;
        /* Floor at the gauge's own nowrap value so a narrowing panel wraps the
           row instead of letting the text paint over the next gauge. */
        min-width: fit-content;
        flex: 1 1 6.5rem;
        max-width: 12rem;
      }

      /* A governor with no activity and nothing consumed — kept for stable
         positions but de-emphasised. */
      .gauge.muted {
        opacity: 0.5;
      }

      .gauge__label {
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }

      .gauge__value {
        font-family: var(--vscode-editor-font-family, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.95rem;
        white-space: nowrap;
      }

      .gauge__limit,
      .gauge__na {
        color: var(--vscode-descriptionForeground);
      }

      .gauge__na {
        font-size: 0.78rem;
        font-style: italic;
      }

      .gauge__track {
        height: 5px;
        border-radius: 3px;
        background: var(--vscode-editorWidget-border, var(--vscode-panel-border));
        overflow: hidden;
      }

      .gauge__fill {
        height: 100%;
        border-radius: 3px;
        transition: width 150ms ease;
      }

      .gauge__fill--safe {
        background: var(--vscode-charts-green, #388a34);
      }
      .gauge__fill--warn {
        background: var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground));
      }
      .gauge__fill--danger {
        background: var(--vscode-errorForeground, #f14c4c);
      }

      @media (prefers-reduced-motion: reduce) {
        .gauge__fill {
          transition: none;
        }
      }
    `,
  ];

  render() {
    if (!this.metrics.length) {
      return nothing;
    }
    return html`<div class="gauges">${this.metrics.map((m) => this._renderGauge(m))}</div>`;
  }

  private _renderGauge(metric: GaugeMetric) {
    const muted = metric.found === 0 && (metric.used ?? 0) === 0;
    const format = metric.format ?? integer.format;

    if (metric.used === null || metric.limit <= 0) {
      return html`<div class="gauge ${muted ? 'muted' : ''}">
        <span class="gauge__label">${metric.label}</span>
        <span class="gauge__value"
          >${format(metric.found)} <span class="gauge__na">seen</span></span
        >
      </div>`;
    }

    const percent = (metric.used / metric.limit) * 100;
    return html`<div
      class="gauge ${muted ? 'muted' : ''}"
      role="meter"
      aria-label="${metric.label}"
      aria-valuenow="${metric.used}"
      aria-valuemax="${metric.limit}"
    >
      <span class="gauge__label">${metric.label}</span>
      <span class="gauge__value"
        >${format(metric.used)} <span class="gauge__limit">/ ${format(metric.limit)}</span></span
      >
      <div class="gauge__track">
        <div
          class="gauge__fill gauge__fill--${governorTier(percent)}"
          style="width: ${Math.min(percent, 100)}%"
        ></div>
      </div>
    </div>`;
  }
}
