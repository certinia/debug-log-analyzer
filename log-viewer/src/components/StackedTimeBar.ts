/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import { formatDuration, formatInteger } from '../core/utility/Util.js';
import { globalStyles } from '../styles/global.styles.js';

// web components
import './ColorSwatch.js';

/** One coloured length of a {@link StackedTimeBar}, in the bar's own unit. */
export interface StackedSegment {
  label: string;
  value: number;
  color: string;
  /** What the segment is made of. Shown in the tip. */
  detail?: string;
  /** The segments this one stands for. A tail lists them in its tip. */
  parts?: readonly StackedSegment[];
}

/** How many of a tail's parts its tip names before it counts the rest. */
const TIP_PARTS = 5;

/**
 * How many segments a bar colours before the rest go to its tail. Six reads as
 * two rows of legend in a narrow dock, and a narrower segment is too thin to hit.
 */
export const DEFAULT_MAX_SEGMENTS = 6;

/**
 * Every row as a segment, with those past `max` gathered into one muted tail, so
 * a bar with more rows than it can colour still totals the whole. The tail
 * carries the segments it stands for, which its tip names.
 */
export function segmentsWithTail<T>(
  rows: readonly T[],
  toSegment: (row: T, index: number) => StackedSegment,
  max: number = DEFAULT_MAX_SEGMENTS,
): StackedSegment[] {
  const segments = rows.map(toSegment);
  if (segments.length <= max) {
    return segments;
  }
  const rest = segments.slice(max);
  return [
    ...segments.slice(0, max),
    {
      label: `${formatInteger(rest.length)} others`,
      value: rest.reduce((running, segment) => running + segment.value, 0),
      color: 'var(--lana-fg-muted)',
      parts: rest,
    },
  ];
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

  /** Lit drops the tip element with the hover, which takes its open state too. */
  private _tipShown = false;

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

      /* What the tip points at: the pointer's place on the bar, given a box the
       top-layer tip can anchor to. */
      .tip-anchor {
        position: absolute;
        pointer-events: none;
        inset-block: 0;
        width: var(--lana-stroke);
        anchor-name: --stacked-bar-tip;
      }

      /* The readout. The legend carries the same figures, but a narrow or
       scrolled panel can push it out of view, so the bar answers too. In the top
       layer, so no pane clips or covers it. */
      .tip {
        position: fixed;
        position-anchor: --stacked-bar-tip;
        /* Out from the pointer, flipping rather than leaving the window. */
        position-area: block-end span-inline-end;
        position-try-fallbacks:
          flip-block,
          flip-inline,
          flip-block flip-inline;
        /* Rather than strand at stale coordinates once the bar scrolls away. */
        position-visibility: anchors-visible;
        inset: auto;
        margin-block: var(--lana-space-2xs);
        pointer-events: none;
        width: max-content;
        max-width: min(40ch, 90vw);
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

      .legend__value,
      .tip__part-value {
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        color: var(--lana-fg-muted);
      }

      /* What a tail stands for, one name a line under its own readout. */
      .tip__parts {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0 var(--lana-space-sm);
        padding-top: var(--lana-space-3xs);
        color: var(--lana-fg-muted);
      }

      /* The count of what the tip had no room to name spans both columns. */
      .tip__parts-rest {
        grid-column: 1 / -1;
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
    const tipSlice = hover?.onBar || hovered?.detail || hovered?.parts ? hovered : undefined;
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
          @pointerleave=${this._clearHover}
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
            ? html`<span
                  class="tip-anchor"
                  style=${styleMap({ left: `${tipCenter.toFixed(1)}%` })}
                ></span>
                <div class="tip" popover="manual">
                  ${tipSlice.label} ·
                  ${readout(tipSlice.value, denominator, this.format)}${
                    tipSlice.detail ? ` · ${tipSlice.detail}` : ''
                  }
                  ${tipSlice.parts ? this._parts(tipSlice.parts, denominator) : ''}
                </div>`
            : ''
        }
      </div>
      ${this.legend ? this._legend(laid, denominator) : ''}
    `;
  }

  /** The names a tail stands for, biggest first, then a count for any past the list. */
  private _parts(parts: readonly StackedSegment[], denominator: number): TemplateResult {
    const rest = parts.length - TIP_PARTS;
    return html`<span class="tip__parts">
      ${parts
        .slice(0, TIP_PARTS)
        .map(
          (part) =>
            html`<span>${part.label}</span>
              <span class="tip__part-value"
                >${readout(part.value, denominator, this.format)}</span
              >`,
        )}
      ${rest > 0 ? html`<span class="tip__parts-rest">+${formatInteger(rest)} more</span>` : ''}
    </span>`;
  }

  /** A tip in the top layer would outlive the segments it read, so it goes with them. */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('segments')) {
      this._clearHover();
    }
  }

  /** The tip only reaches the top layer, past every pane's clipping, once shown. */
  protected updated(): void {
    const tip = this.renderRoot.querySelector<HTMLElement>('.tip');
    if (!tip) {
      this._tipShown = false;
    } else if (!this._tipShown && typeof tip.showPopover === 'function') {
      tip.showPopover();
      this._tipShown = true;
    }
  }

  private _clearHover = () => {
    this._hover = null;
    this._pointerPercent = null;
  };

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
            <color-swatch color=${segment.color}></color-swatch>
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
