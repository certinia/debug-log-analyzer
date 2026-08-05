/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, svg } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { eventBus } from '../core/events/EventBus.js';
import { formatDuration } from '../core/utility/Util.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { globalStyles } from '../styles/global.styles.js';
import {
  governorTrendSeries,
  pointAt,
  type TrendPoint,
  type TrendSeries,
} from './governorTrendData.js';

/** Chart-space size; the SVG stretches to fill its row. */
const VIEW_W = 100;
const VIEW_H = 30;

/** The warn threshold the guide line marks, as used/limit percent. */
const WARN_PERCENT = 80;

function tier(percent: number): 'safe' | 'warn' | 'danger' {
  if (percent >= 100) {
    return 'danger';
  }
  return percent >= WARN_PERCENT ? 'warn' : 'safe';
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

  private _offLogLoaded: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    // The inspector paints before the first parse and rebuilds only on a tab
    // change or a selection, so the charts have to follow the log itself.
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
        /* Left inset lines the content up with the other sections' text. */
        padding: var(--lana-space-sm) var(--lana-space-md) var(--lana-space-md)
          var(--lana-section-inset);
      }

      .note {
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

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
        padding-bottom: 4px;
      }

      .trend__label {
        display: block;
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* The value owns its line: the hover readout is wider than the final
         figure, and sharing a line with the label made it jump rows and shift
         the chart under the pointer. */
      .trend__value {
        display: block;
        font-family: var(--vscode-editor-font-family, monospace);
        font-variant-numeric: tabular-nums;
        font-size: var(--lana-text-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .trend__limit {
        color: var(--vscode-descriptionForeground);
      }

      .trend__chart {
        display: block;
        width: 100%;
        height: 44px;
        border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      }

      .trend--safe {
        color: var(--vscode-charts-green, #388a34);
      }
      .trend--warn {
        color: var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground));
      }
      .trend--danger {
        color: var(--vscode-errorForeground, #f14c4c);
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
    const apexLog = DatabaseAccess.instance()?.getApexLog();
    if (!apexLog) {
      return html`<p class="note">No log is loaded.</p>`;
    }
    const series = governorTrendSeries(apexLog.governorLimits);
    if (!series.length) {
      return html`<p class="note">
        This log holds too few limit snapshots to draw a trend. The parser samples them from
        CUMULATIVE_LIMIT_USAGE events.
      </p>`;
    }

    const logTotal = apexLog.duration.total;
    return html`<div class="trends"> ${series.map((s) => this._renderTrend(s, logTotal))} </div>`;
  }

  private _renderTrend(series: TrendSeries, logTotal: number) {
    const maxRatio = Math.max(100, ...series.points.map((p) => p.ratio));
    const x = (t: number) => (logTotal > 0 ? (t / logTotal) * VIEW_W : 0);
    const y = (ratio: number) => VIEW_H - (ratio / maxRatio) * VIEW_H;

    const line = series.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)} ${y(p.ratio).toFixed(2)}`)
      .join(' ');
    // Consumption never resets inside a transaction, so hold the last sample's
    // level out to the end of the log before closing down to the baseline.
    const lastPoint = series.points[series.points.length - 1];
    const lastY = lastPoint ? y(lastPoint.ratio).toFixed(2) : `${VIEW_H}`;
    const area = `${line} L${VIEW_W} ${lastY} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z`;
    const guideY = y(WARN_PERCENT).toFixed(2);

    const hovered = this._hover?.label === series.label ? this._hover.point : null;
    const hoverX = hovered ? x(hovered.t).toFixed(2) : null;

    return html`<div class="trend trend--${tier(series.finalRatio)}">
      <div class="trend__head">
        <span class="trend__label">${series.label}</span>
        <span class="trend__value"
          >${hovered ? html`${formatDuration(hovered.t)} · ` : ''}${series.format(
            hovered ? hovered.used : series.used,
          )}
          <span class="trend__limit"
            >/ ${series.format(hovered ? hovered.limit : series.limit)}</span
          ></span
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
          <path class="trend__line" d=${`${line} L${VIEW_W} ${lastY}`}></path>
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
