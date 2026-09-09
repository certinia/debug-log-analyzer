/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { NO_LIMIT_FOR_METRIC_TEXT } from '../../../components/governorCopy.js';
import { globalStyles } from '../../../styles/global.styles.js';

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
   * How to write every number this gauge shows. Required, so a new figure on the gauge cannot be
   * printed raw: a byte metric passes a compact formatter, since `5,400,000 / 6,000,000` is wider
   * than a gauge.
   */
  format: (value: number) => string;
  /**
   * The metric's level over the log, oldest first, drawn where the track sits when there is no
   * limit to fill a bar against. Empty where there are too few readings to read as a shape.
   */
  spark?: readonly number[];
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

      /* No padding of its own: each host sets its content edge on the element. */
      .gauges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 22px;
      }

      .gauge {
        display: flex;
        flex-direction: column;
        gap: 4px;
        /* The label and the value never wrap, so a gauge must not shrink below
           the wider of the two: at a 6.5rem floor a long value overflowed its
           box and ran over the next gauge. min-content wraps the row instead. */
        min-width: min-content;
        flex: 1 1 6.5rem;
        max-width: 12rem;
      }

      /* A governor with no activity and nothing consumed — kept for stable
         positions but de-emphasised. */
      .gauge.muted {
        opacity: 0.5;
      }

      .gauge__label {
        font-size: var(--lana-text-caps);
        letter-spacing: var(--lana-text-caps-tracking);
        text-transform: uppercase;
        color: var(--lana-fg-muted);
        white-space: nowrap;
      }

      /* No size of its own: the figure reads at whatever surface holds it. */
      .gauge__value {
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .gauge__limit,
      .gauge__na {
        color: var(--lana-fg-muted);
      }

      .gauge__na {
        font-size: var(--lana-text-xs);
        font-style: italic;
      }

      /* The height a bar would have taken plus a little, so a row grows by a few pixels rather
         than turning into a chart strip. Overflow visible: the peak vertex sits on y=0, so half
         the non-scaling stroke falls outside the viewBox and would be clipped. */
      .gauge__spark {
        display: block;
        width: 100%;
        height: 10px;
        overflow: visible;
        color: var(--lana-fg-muted);
      }

      .gauge__track {
        height: 5px;
        border-radius: var(--lana-radius-pill);
        background: var(--lana-surface-border);
        overflow: hidden;
      }

      .gauge__fill {
        height: 100%;
        border-radius: var(--lana-radius-pill);
        transition: width 150ms ease;
      }

      .gauge__fill--safe {
        background: var(--lana-severity-ok);
      }
      .gauge__fill--warn {
        background: var(--lana-severity-warning);
      }
      .gauge__fill--danger {
        background: var(--lana-severity-error);
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
    const { format } = metric;

    if (metric.used === null || metric.limit <= 0) {
      // No limit, so no meter: a bar against the level's own peak would sit full and read as a
      // breach, and a sparkline has no `aria-valuemax` to give.
      return html`<div class="gauge ${muted ? 'muted' : ''}" title=${NO_LIMIT_FOR_METRIC_TEXT}>
        <span class="gauge__label">${metric.label}</span>
        <span class="gauge__value"
          >${format(metric.found)} <span class="gauge__na">seen</span></span
        >
        ${this._renderSpark(metric)}
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

  /** The level over the log, scaled to its own peak. Nothing to draw without a peak. */
  private _renderSpark(metric: GaugeMetric) {
    const spark = metric.spark ?? [];
    const peak = spark.reduce((highest, level) => (level > highest ? level : highest), 0);
    if (peak <= 0) {
      return nothing;
    }

    // A 0-100 x 0-10 box stretched to the gauge's width, so the path needs no pixel measurements.
    const points = spark
      .map((level, i) => {
        const x = spark.length > 1 ? (i / (spark.length - 1)) * 100 : 0;
        return `${x.toFixed(2)},${(10 - (level / peak) * 10).toFixed(2)}`;
      })
      .join(' ');

    return html`<svg
      class="gauge__spark"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      role="img"
      aria-label="${metric.label} over the log, highest point ${metric.format(peak)}"
    >
      <polyline
        points="${points}"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    </svg>`;
  }
}
