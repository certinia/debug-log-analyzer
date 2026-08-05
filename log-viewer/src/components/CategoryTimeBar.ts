/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, svg } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { formatDuration } from '../core/utility/Util.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { subscribeSettings } from '../features/settings/Settings.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { categoryPalette, categorySelfTimes } from './categoryTime.js';

/**
 * The whole log's self time split by category, as one stacked bar in the flame
 * chart's own palette — the Inspector's answer to Chrome DevTools' Summary
 * donut. Self time, so every nanosecond lands in exactly one slice and the bar
 * always totals the log.
 */
@customElement('category-time-bar')
export class CategoryTimeBar extends LitElement {
  /** The category under the pointer — over its slice or its legend item.
   *  `onSlice` gates the bar's readout tip: only a slice hover shows it. */
  @state()
  private _hover: { category: string; onSlice: boolean } | null = null;

  private _color: (category: string) => string = categoryPalette(null);
  private _offSettings: (() => void) | null = null;

  /** The bar has to follow the log itself. */
  private readonly _logLoaded = new LogLoadedController(this);

  override connectedCallback() {
    super.connectedCallback();
    // The palette follows the timeline's theme settings live, so a theme change
    // recolours the bar the way it recolours the flame chart.
    this._offSettings = subscribeSettings((settings) => {
      this._color = categoryPalette(settings.timeline);
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    this._offSettings?.();
    this._offSettings = null;
    super.disconnectedCallback();
  }

  static styles = [
    globalStyles,
    inspectorSectionStyles,
    css`
      .chart {
        position: relative;
      }

      .bar {
        display: block;
        width: 100%;
        height: 12px;
        border-radius: var(--lana-radius-sm);
      }

      /* The slice readout. The legend carries the same figures, but a narrow
         or scrolled panel can push it out of view, so the bar answers too.
         Anchored to the hovered slice's centre — not the pointer — so it never
         lags, and below the bar because above it the section title covers it. */
      .tip {
        position: absolute;
        top: calc(100% + var(--lana-space-3xs));
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
        gap: 4px 18px;
        padding-top: var(--lana-space-sm);
      }

      .legend__item {
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
      }

      .legend__swatch {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        align-self: center;
        flex: none;
      }

      .legend__value {
        font-family: var(--vscode-editor-font-family, monospace);
        font-variant-numeric: tabular-nums;
        font-size: var(--lana-text-sm);
        color: var(--lana-fg-muted);
      }

      /* Hovering a slice or a legend item singles its category out: the other
         slices recede and the matching legend figures come up to full strength.
         The legend side matters — the thinnest slices are too small to hit. */
      .bar__slice {
        transition: opacity 0.15s ease;
      }

      .bar__slice--dim {
        opacity: 0.45;
      }

      .legend__item--active .legend__value {
        color: var(--lana-fg);
      }
    `,
  ];

  render() {
    const apexLog = DatabaseAccess.instance()?.getApexLog();
    const slices = apexLog ? categorySelfTimes(apexLog) : [];
    const total = slices.reduce((sum, slice) => sum + slice.selfTime, 0);
    if (!total) {
      return html`<p class="note">No categorised time was recorded in this log.</p>`;
    }

    // Lay the slices out once; the tip and the rects share the geometry.
    let x = 0;
    const laid = slices.map((slice) => {
      const start = x;
      const width = (slice.selfTime / total) * 100;
      x += width;
      return { ...slice, start, width };
    });
    const hover = this._hover;
    const tipSlice = hover?.onSlice ? laid.find((s) => s.category === hover.category) : undefined;
    const tipCenter = tipSlice ? tipSlice.start + tipSlice.width / 2 : 0;

    return html`
      <div class="chart">
        <svg
          class="bar"
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
          role="img"
          aria-label="Time by category"
        >
          ${laid.map(
            (slice) => svg`<rect
              class=${
                hover !== null && hover.category !== slice.category
                  ? 'bar__slice bar__slice--dim'
                  : 'bar__slice'
              }
              x=${slice.start.toFixed(3)} y="0" width=${slice.width.toFixed(3)} height="4"
              fill=${this._color(slice.category)}
              @pointerenter=${() => (this._hover = { category: slice.category, onSlice: true })}
              @pointerleave=${() => (this._hover = null)}
            ></rect>`,
          )}
        </svg>
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
                ${tipSlice.category} · ${this._readout(tipSlice.selfTime, total)}
              </div>`
            : ''
        }
      </div>
      <div class="legend">
        ${laid.map(
          (slice) => html`
            <span
              class=${classMap({
                legend__item: true,
                'legend__item--active': hover?.category === slice.category,
              })}
              @pointerenter=${() => (this._hover = { category: slice.category, onSlice: false })}
              @pointerleave=${() => (this._hover = null)}
            >
              <span
                class="legend__swatch"
                style=${styleMap({ background: this._color(slice.category) })}
              ></span>
              <span>${slice.category}</span>
              <span class="legend__value"> ${this._readout(slice.selfTime, total)} </span>
            </span>
          `,
        )}
      </div>
    `;
  }

  /** `duration · percent` — the tip and the legend show the same figures. */
  private _readout(selfTime: number, total: number): string {
    return `${formatDuration(selfTime)} · ${((selfTime / total) * 100).toFixed(1)}%`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'category-time-bar': CategoryTimeBar;
  }
}
