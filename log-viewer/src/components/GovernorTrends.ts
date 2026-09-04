/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, svg, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { eventBus } from '../core/events/EventBus.js';
import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { formatDuration } from '../core/utility/Util.js';
import {
  GOVERNOR_WARN_PERCENT,
  governorTier,
} from '../features/database/components/GovernorSummary.js';
import { apexLimitTimeSeries } from '../features/timeline/optimised/apex-limit-series.js';
import { SEEK_LOG_SHARE } from '../features/timeline/utils/navigate-window.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import {
  governorTrendSeries,
  pointAt,
  type TrendPoint,
  type TrendSeries,
} from './governorTrendData.js';
import { NO_CUMULATIVE_LIMITS_TEXT } from './logOverviewMetrics.js';

/** A placed cursor: the sample, and the chart it belongs to. */
interface Cursor {
  label: string;
  point: TrendPoint;
}

/** The cursor's sample, when it is this chart's. */
function pointOn(cursor: Cursor | null, series: TrendSeries): TrendPoint | null {
  return cursor?.label === series.label ? cursor.point : null;
}

/** Chart-space size; the SVG stretches to fill its row. */
const VIEW_W = 100;
const VIEW_H = 30;

/** How far one arrow key moves the cursor: the seek window's own share of the
 *  log, so successive steps sweep the log without leaving a gap between the
 *  windows they can reach. */
const KEY_STEP = SEEK_LOG_SHARE;

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
 *
 * A click, or Enter on a focused chart, moves the timeline to that instant and
 * zooms in on it, so a spike leads straight to its cause. The chart selects
 * nothing, so the inspector keeps its whole-log reading.
 */
@customElement('governor-trends')
export class GovernorTrends extends LitElement {
  /** The sample under the pointer, on the chart it is over. Cleared when the
   *  pointer leaves, so it never outlives the hover that made it. */
  @state()
  private _hover: Cursor | null = null;

  /** Where the arrow keys left the cursor. Held apart from the hover because a
   *  pointer crossing any chart would otherwise erase a stepped position. */
  @state()
  private _keyed: Cursor | null = null;

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

      /* A button, not the svg itself: Chromium matches :focus-visible on a
         click for a focusable svg, so the ring appeared on every seek. */
      .trend__chart {
        display: block;
        width: 100%;
        border: 0;
        border-bottom: 1px solid var(--lana-surface-border);
        padding: 0;
        background: none;
        color: inherit;
        cursor: pointer;
      }

      .trend__plot {
        display: block;
        width: 100%;
        height: 44px;
      }

      .trend__chart:focus-visible {
        outline: var(--lana-stroke) solid var(--lana-focus-border);
        outline-offset: calc(-1 * var(--lana-stroke));
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
      .trend__cursor {
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
    const cursor = this._cursorFor(series);
    const cursorX = cursor ? x(cursor.t).toFixed(2) : null;

    return html`<div class="trend trend--${governorTier(series.finalRatio)}">
      <div class="trend__head">
        <span class="trend__label">${series.label}</span>
        <span class="trend__value" aria-live="polite"
          >${cursor ? html`${formatDuration(cursor.t)} · ` : ''}${series.format(
            cursor ? cursor.used : series.used,
          )} <span class="trend__limit">/ ${series.format(series.limit)}</span></span
        >
      </div>
      <button
        class="trend__chart"
        type="button"
        aria-label="${series.label}: ${Math.round(
          series.finalRatio,
        )}% of the limit used. Move the timeline to a point in the log."
        @pointermove=${(event: PointerEvent) => this._onPointerMove(event, series, logTotal)}
        @pointerleave=${() => this._onPointerLeave()}
        @click=${(event: PointerEvent) => this._onClick(event, series, logTotal)}
        @keydown=${(event: KeyboardEvent) => this._onKeyDown(event, series, logTotal)}
      >
        <svg
          class="trend__plot"
          viewBox="0 0 ${VIEW_W} ${VIEW_H}"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          ${svg`
            <path class="trend__area" d=${area}></path>
            <path class="trend__line" d=${line}></path>
            <line class="trend__guide" x1="0" y1=${guideY} x2=${VIEW_W} y2=${guideY}></line>
            ${cursorX === null ? '' : svg`<line class="trend__cursor" x1=${cursorX} y1="0" x2=${cursorX} y2=${VIEW_H}></line>`}
          `}
        </svg>
      </button>
    </div>`;
  }

  /** A cursor belongs to the log that placed it; metric labels repeat. */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('logStore')) {
      this._hover = null;
      this._keyed = null;
    }
  }

  private _onPointerMove(event: PointerEvent, series: TrendSeries, logTotal: number): void {
    const point = this._pointFrom(event, series, logTotal);
    this._hover = point ? { label: series.label, point } : null;
  }

  /** Puts the cursor where the keys left it. A resting pointer would otherwise
   *  answer every step from the same sample, so the keys take this chart from
   *  it; moving the pointer takes it back. */
  private _hold(series: TrendSeries, point: TrendPoint | null | undefined): TrendPoint | null {
    if (!point) {
      return null;
    }
    this._keyed = { label: series.label, point };
    if (this._hover?.label === series.label) {
      this._hover = null;
    }
    return point;
  }

  /**
   * What an activation moves to: the sample given, else this chart's cursor,
   * else the last sample, since consumption never falls inside a transaction
   * and that is where the metric stands highest.
   */
  private _target(series: TrendSeries, placed: TrendPoint | null): TrendPoint | null {
    return placed ?? this._cursorFor(series) ?? series.points.at(-1) ?? null;
  }

  private _onPointerLeave(): void {
    this._hover = null;
  }

  private _onClick(event: PointerEvent, series: TrendSeries, logTotal: number): void {
    // Where the pointer is wins, but a click carrying no coordinates (assistive
    // tech, or `click()`) reports x 0, which would seek the log's start.
    const placed = event.detail === 0 ? null : this._pointFrom(event, series, logTotal);
    // No cursor is kept: the pointer is still on the chart and holds its own,
    // and a second chart reading at once says two things at the same time.
    const point = this._target(series, placed);
    if (point) {
      this._seek(point.t);
    }
  }

  /**
   * Arrows step the cursor across the log; Enter and Space move the timeline to
   * it. With no cursor the last sample answers: consumption never falls inside
   * a transaction, so that is where the metric stands highest.
   */
  private _onKeyDown(event: KeyboardEvent, series: TrendSeries, logTotal: number): void {
    const step =
      event.key === 'ArrowRight' ? KEY_STEP : event.key === 'ArrowLeft' ? -KEY_STEP : undefined;
    const activates = event.key === 'Enter' || event.key === ' ';
    if (step === undefined && !activates) {
      return;
    }
    event.preventDefault();
    if (step !== undefined) {
      const from = this._cursorFor(series)?.t ?? 0;
      const t = Math.min(Math.max(from + step * logTotal, 0), logTotal);
      this._hold(series, pointAt(series.points, t));
      return;
    }
    // Arrows repeat, so holding one scrubs the cursor. An activation must not:
    // it would re-zoom the flame chart on every repeat.
    if (event.repeat) {
      return;
    }
    // The cursor stays where this landed, so the arrows carry on from it.
    const point = this._hold(series, this._target(series, null));
    if (point) {
      this._seek(point.t);
    }
  }

  /** This chart's cursor: the pointer's while it is over the chart, else the
   *  keys'. */
  private _cursorFor(series: TrendSeries): TrendPoint | null {
    return pointOn(this._hover, series) ?? pointOn(this._keyed, series);
  }

  /** The series' value at the pointer, in the log's own time. */
  private _pointFrom(
    event: PointerEvent,
    series: TrendSeries,
    logTotal: number,
  ): TrendPoint | null {
    // currentTarget is the button the handler is bound to; event.target could be
    // one of the plot's paths, whose offsetX is useless here.
    const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    if (rect.width <= 0 || logTotal <= 0) {
      return null;
    }
    return pointAt(series.points, ((event.clientX - rect.left) / rect.width) * logTotal);
  }

  /**
   * Move the timeline to `t` and zoom to a window of the log around it. Nothing
   * is selected: these charts read the whole log, and a selection would swap the
   * inspector to one frame's detail.
   */
  private _seek(t: number): void {
    eventBus.emit('timeline:navigate-to', { timestamp: t, mode: 'seek' });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'governor-trends': GovernorTrends;
  }
}
