/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { formatDuration } from '../core/utility/Util.js';
import {
  GOVERNOR_WARN_PERCENT,
  governorTier,
} from '../features/database/components/GovernorSummary.js';
import { apexLimitTimeSeries } from '../features/timeline/optimised/apex-limit-series.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import {
  governorTrendSeries,
  pointAt,
  type TrendPoint,
  type TrendSeries,
} from './governorTrendData.js';
import { NO_CUMULATIVE_LIMITS_TEXT } from './logOverviewMetrics.js';

/** Chart-space size; the SVG stretches to fill its row. */
const VIEW_W = 100;
const VIEW_H = 30;

/** The pieces of a chart that depend only on the data, never the hover. */
interface TrendGeometry {
  line: string;
  area: string;
  guideY: string;
  x: (t: number) => number;
}

/** Memo of {@link trendGeometry}: a hover re-renders every chart on every
 *  pointer move, but a series' shape never changes, and the series identity
 *  is stable per log. */
const geometryCache = new WeakMap<TrendSeries, TrendGeometry>();

function trendGeometry(series: TrendSeries, logTotal: number): TrendGeometry {
  const cached = geometryCache.get(series);
  if (cached) {
    return cached;
  }

  const maxRatio = Math.max(100, ...series.points.map((p) => p.ratio));
  const x = (t: number) => (logTotal > 0 ? (t / logTotal) * VIEW_W : 0);
  const y = (ratio: number) => VIEW_H - (ratio / maxRatio) * VIEW_H;

  const path = series.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)} ${y(p.ratio).toFixed(2)}`)
    .join(' ');
  // Consumption never resets inside a transaction, so hold the last sample's
  // level out to the end of the log before closing down to the baseline.
  // A series always holds an anchor plus at least one sample.
  const lastY = y(series.points[series.points.length - 1]!.ratio).toFixed(2);
  const line = `${path} L${VIEW_W} ${lastY}`;

  const geometry = {
    line,
    area: `${line} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z`,
    guideY: y(GOVERNOR_WARN_PERCENT).toFixed(2),
    x,
  };
  geometryCache.set(series, geometry);
  return geometry;
}

/**
 * Small-multiple area charts of governor consumption over the log, for the
 * metrics closest to their limits. Every chart shares the same x-domain (the
 * whole log) so shapes are comparable; each y-domain runs to at least 100% so
 * a flat safe line reads as safe. Colours follow the gauges' tiers.
 */
@customElement('governor-trends')
export class GovernorTrends extends LitElement {
  /** The sample under the pointer, on the one hovered chart. */
  @state()
  private _hover: { label: string; point: TrendPoint } | null = null;

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    globalStyles,
    inspectorSectionStyles,
    css`
      .trends {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
        gap: var(--lana-space-md) var(--lana-space-lg);
      }

      /* min-width lets the head clip inside its grid column instead of
         pushing the neighbouring chart. */
      .trend {
        min-width: 0;
      }

      .trend__head {
        padding-bottom: var(--lana-space-2xs);
      }

      .trend__label {
        display: block;
        font-size: var(--lana-text-caps);
        letter-spacing: var(--lana-text-caps-tracking);
        text-transform: uppercase;
        color: var(--lana-fg-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* The value owns its line: the hover readout is wider than the final
         figure, and sharing a line with the label made it jump rows and shift
         the chart under the pointer. */
      .trend__value {
        display: block;
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .trend__limit {
        color: var(--lana-fg-muted);
      }

      .trend__chart {
        display: block;
        width: 100%;
        height: 44px;
        border-bottom: 1px solid var(--lana-surface-border);
      }

      .trend--safe {
        color: var(--lana-severity-ok);
      }
      .trend--warn {
        color: var(--lana-severity-warning);
      }
      .trend--danger {
        color: var(--lana-severity-error);
      }

      .trend__area {
        fill: currentColor;
        opacity: 0.25;
      }

      .trend__line {
        fill: none;
        stroke: currentColor;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }

      .trend__guide {
        stroke: var(--lana-fg-muted);
        stroke-width: 1;
        stroke-dasharray: 3 3;
        vector-effect: non-scaling-stroke;
        opacity: 0.6;
      }

      /* A vertical line, not a circle — preserveAspectRatio="none" would
         distort any shape with area. */
      .trend__hover {
        stroke: currentColor;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
    `,
  ];

  render() {
    const apexLog = this.logStore?.log;
    if (!apexLog) {
      return html`<p class="note">No log is loaded.</p>`;
    }
    const series = governorTrendSeries(apexLimitTimeSeries(apexLog));
    if (!series.length) {
      return html`<p class="note">${NO_CUMULATIVE_LIMITS_TEXT}</p>`;
    }

    // With no cumulative snapshots the series draws from granular events and
    // the default limits — the Log overview above carries the estimated note.
    const logTotal = apexLog.duration.total;
    return html`<div class="trends">${series.map((s) => this._renderTrend(s, logTotal))}</div>`;
  }

  private _renderTrend(series: TrendSeries, logTotal: number) {
    const { line, area, guideY, x } = trendGeometry(series, logTotal);
    const hovered = this._hover?.label === series.label ? this._hover.point : null;
    const hoverX = hovered ? x(hovered.t).toFixed(2) : null;

    return html`<div class="trend trend--${governorTier(series.finalRatio)}">
      <div class="trend__head">
        <span class="trend__label">${series.label}</span>
        <span class="trend__value"
          >${hovered ? html`${formatDuration(hovered.t)} · ` : ''}${series.format(
            hovered ? hovered.used : series.used,
          )} <span class="trend__limit">/ ${series.format(series.limit)}</span></span
        >
      </div>
      <svg
        class="trend__chart"
        viewBox="0 0 ${VIEW_W} ${VIEW_H}"
        preserveAspectRatio="none"
        role="img"
        aria-label="${series.label}: ${Math.round(series.finalRatio)}% of the limit used"
        @pointermove=${(event: PointerEvent) => this._onPointerMove(event, series, logTotal)}
        @pointerleave=${() => (this._hover = null)}
      >
        ${svg`
          <path class="trend__area" d=${area}></path>
          <path class="trend__line" d=${line}></path>
          <line class="trend__guide" x1="0" y1=${guideY} x2=${VIEW_W} y2=${guideY}></line>
          ${hoverX === null ? '' : svg`<line class="trend__hover" x1=${hoverX} y1="0" x2=${hoverX} y2=${VIEW_H}></line>`}
        `}
      </svg>
    </div>`;
  }

  private _onPointerMove(event: PointerEvent, series: TrendSeries, logTotal: number) {
    // currentTarget is the <svg> the handler is bound to; event.target could be
    // one of its paths, whose offsetX is useless here.
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    if (rect.width <= 0 || logTotal <= 0) {
      return;
    }
    const t = ((event.clientX - rect.left) / rect.width) * logTotal;
    const point = pointAt(series.points, t);
    this._hover = point ? { label: series.label, point } : null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'governor-trends': GovernorTrends;
  }
}
