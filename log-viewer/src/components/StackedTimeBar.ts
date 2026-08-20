/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import { formatDuration, formatInteger } from '../core/utility/Util.js';
import { globalStyles } from '../styles/global.styles.js';

/** One coloured length of a {@link StackedTimeBar}, in the bar's own unit. */
export interface StackedSegment {
  label: string;
  value: number;
  color: string;
  /** What the segment is made of. Shown in the tip. */
  detail?: string;
}

/**
 * The first `max` rows as segments, with everything past them gathered into one
 * muted tail, so a bar with more rows than it can colour still totals the whole.
 *
 * The tail reads its size through `sizeOf`, so a row past `max` never pays for a
 * segment that is thrown away.
 */
export function segmentsWithTail<T>(
  rows: readonly T[],
  max: number,
  toSegment: (row: T, index: number) => StackedSegment,
  sizeOf: (row: T) => number,
): StackedSegment[] {
  const segments = rows.slice(0, max).map(toSegment);
  if (rows.length > max) {
    let tail = 0;
    for (let index = max; index < rows.length; index++) {
      tail += sizeOf(rows[index]!); // in range: below rows.length
    }
    segments.push({
      label: `${formatInteger(rows.length - max)} others`,
      value: tail,
      color: 'var(--lana-fg-muted)',
    });
  }
  return segments;
}

/**
 * One quantity as a stacked bar: a segment per part, in the flame chart's own
 * colours, with a hover readout and an optional legend. `format` says what the
 * segments are — durations, or counts such as rows against a governor limit.
 *
 * `total` is the bar's denominator. Set it above the segments' sum and the
 * shortfall stays unfilled, so the bar shows a share of something larger — the
 * database against the whole log — rather than only a split of itself. Below
 * their sum the segments answer instead, and a mark shows where the total fell.
 *
 * Set `--stacked-bar-height` to size it; a row inside a list wants it thinner
 * than a section's own chart.
 */
@customElement('stacked-time-bar')
export class StackedTimeBar extends LitElement {
  @property({ attribute: false })
  segments: readonly StackedSegment[] = [];

  /** Denominator, in the segments' unit. Zero or below their sum: the sum answers. */
  @property({ type: Number })
  total = 0;

  /** How a figure reads. A count bar passes `formatInteger`. */
  @property({ attribute: false })
  format: (value: number) => string = formatDuration;

  /** Show the figures beneath the bar, one item per segment. */
  @property({ type: Boolean })
  legend = false;

  /** Accessible name for the bar itself. */
  @property()
  label = '';

  /** The segment under the pointer — over the bar or its legend item. `onBar`
   *  gates the readout tip: a legend hover only gets one for a `detail`, which
   *  the legend item does not itself carry. */
  @state()
  private _hover: { label: string; onBar: boolean } | null = null;

  /** Where the pointer is across the bar (percent). Whole numbers, so a move
   *  inside a pixel or two costs no render. */
  @state()
  private _pointerPercent: number | null = null;

  static styles = [
    globalStyles,
    css`
      .chart {
        position: relative;
      }

      /* The unfilled remainder: the track shows through wherever the segments
       stop, which is what makes the bar a share and not just a split. */
      .bar {
        display: block;
        width: 100%;
        height: var(--stacked-bar-height, 12px);
        border-radius: var(--lana-radius-sm);
        background: color-mix(in srgb, var(--lana-meter-fill) 22%, transparent);
      }

      /* Where the total fell once the segments passed it. A line rather than an
       edge: the segments own the whole bar by then. */
      .limit {
        position: absolute;
        pointer-events: none;
        inset-block: 0;
        width: var(--lana-stroke);
        background: var(--lana-fg);
      }

      /* The readout. The legend carries the same figures, but a narrow or
       scrolled panel can push it out of view, so the bar answers too. It follows
       the pointer along the bar, and sits below it because above it the section
       title covers it. */
      .tip {
        position: absolute;
        top: calc(100% + var(--lana-space-3xs));
        z-index: 1;
        pointer-events: none;
        white-space: nowrap;
        font-size: var(--lana-text-sm);
        color: var(--lana-fg);
        padding: var(--lana-space-3xs) var(--lana-space-xs);
        background: var(--lana-popover-bg);
        border: var(--lana-stroke) solid var(--lana-surface-border);
        border-radius: var(--lana-radius-sm);
        box-shadow: var(--lana-shadow-popover);
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--lana-space-3xs) var(--lana-space-lg);
        padding-top: var(--lana-space-sm);
      }

      .legend__item {
        display: flex;
        align-items: baseline;
        gap: var(--lana-space-2xs);
        white-space: nowrap;
        font-size: var(--lana-text-sm);
        color: var(--lana-fg);
      }

      .legend__swatch {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        align-self: center;
        flex: none;
      }

      .legend__value {
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        color: var(--lana-fg-muted);
      }

      /* Hovering a segment or a legend item singles it out: the others recede and
       the matching legend figures come up to full strength. The legend side
       matters — the thinnest segments are too small to hit. */
      .bar__slice {
        transition: opacity 0.15s ease;
      }

      .bar__slice--dim {
        opacity: 0.45;
      }

      .legend__item--active .legend__value {
        color: var(--lana-fg);
      }

      @media (prefers-reduced-motion: reduce) {
        .bar__slice {
          transition: none;
        }
      }
    `,
  ];

  render() {
    const sum = this.segments.reduce((running, segment) => running + segment.value, 0);
    const denominator = Math.max(this.total, sum);
    if (denominator <= 0) {
      return html``;
    }

    // Lay the segments out once; the tip and the rects share the geometry.
    let x = 0;
    const laid = this.segments.map((segment) => {
      const start = x;
      const width = (segment.value / denominator) * 100;
      x += width;
      return { ...segment, start, width };
    });
    // Only once the segments pass the total: inside it the unfilled remainder is
    // already the mark.
    const limitPercent = this.total > 0 && sum > this.total ? (this.total / sum) * 100 : null;
    const hover = this._hover;
    const hovered = hover ? laid.find((s) => s.label === hover.label) : undefined;
    // A bar hover always gets the readout; a legend hover only when the segment
    // has a detail, which the legend itself does not carry. Without that the
    // detail of a sub-pixel segment could not be reached at all.
    const tipSlice = hover?.onBar || hovered?.detail ? hovered : undefined;
    // The pointer where we have it, the segment's centre until the first move.
    const tipCenter = this._pointerPercent ?? (tipSlice ? tipSlice.start + tipSlice.width / 2 : 0);

    return html`
      <div class="chart">
        <svg
          class="bar"
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
          role="img"
          aria-label=${this.label}
          @pointermove=${this._trackPointer}
          @pointerleave=${() => (this._pointerPercent = null)}
        >
          ${laid.map(
            (segment) => svg`<rect
              class=${
                hover !== null && hover.label !== segment.label
                  ? 'bar__slice bar__slice--dim'
                  : 'bar__slice'
              }
              x=${segment.start.toFixed(3)} y="0" width=${segment.width.toFixed(3)} height="4"
              fill=${segment.color}
              @pointerenter=${() => (this._hover = { label: segment.label, onBar: true })}
              @pointerleave=${() => (this._hover = null)}
            ></rect>`,
          )}
        </svg>
        ${
          limitPercent === null
            ? ''
            : html`<span
                class="limit"
                style=${styleMap({ left: `${limitPercent.toFixed(1)}%` })}
                title=${`Limit ${this.format(this.total)}`}
              ></span>`
        }
        ${
          tipSlice
            ? html`<div
                class="tip"
                style=${styleMap(
                  tipCenter <= 50
                    ? { left: `${tipCenter.toFixed(1)}%` }
                    : { right: `${(100 - tipCenter).toFixed(1)}%` },
                )}
              >
                ${tipSlice.label} ·
                ${readout(tipSlice.value, denominator, this.format)}${
                  tipSlice.detail ? ` · ${tipSlice.detail}` : ''
                }
              </div>`
            : ''
        }
      </div>
      ${this.legend ? this._legend(laid, denominator) : ''}
    `;
  }

  private _trackPointer(event: PointerEvent) {
    const bar = event.currentTarget as SVGElement;
    const { left, width } = bar.getBoundingClientRect();
    if (width <= 0) {
      return;
    }
    const percent = ((event.clientX - left) / width) * 100;
    this._pointerPercent = Math.min(100, Math.max(0, Math.round(percent)));
  }

  private _legend(laid: StackedSegment[], denominator: number): TemplateResult {
    return html`<div class="legend">
      ${laid.map(
        (segment) => html`
          <span
            class=${classMap({
              legend__item: true,
              'legend__item--active': this._hover?.label === segment.label,
            })}
            @pointerenter=${() => (this._hover = { label: segment.label, onBar: false })}
            @pointerleave=${() => (this._hover = null)}
          >
            <span class="legend__swatch" style=${styleMap({ background: segment.color })}></span>
            <span>${segment.label}</span>
            <span class="legend__value">${readout(segment.value, denominator, this.format)}</span>
          </span>
        `,
      )}
    </div>`;
  }
}

/** `figure · percent` — the tip and the legend show the same figures. */
function readout(value: number, denominator: number, format: (value: number) => string): string {
  return `${format(value)} · ${((value / denominator) * 100).toFixed(1)}%`;
}

declare global {
  interface HTMLElementTagNameMap {
    'stacked-time-bar': StackedTimeBar;
  }
}
