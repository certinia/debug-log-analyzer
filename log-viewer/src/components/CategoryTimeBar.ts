/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, svg } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import { eventBus } from '../core/events/EventBus.js';
import { formatDuration } from '../core/utility/Util.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { subscribeSettings, type LanaSettings } from '../features/settings/Settings.js';
import { globalStyles } from '../styles/global.styles.js';
import { categoryPalette, categorySelfTimes } from './categoryTime.js';

/**
 * The whole log's self time split by category, as one stacked bar in the flame
 * chart's own palette — the Inspector's answer to Chrome DevTools' Summary
 * donut. Self time, so every nanosecond lands in exactly one slice and the bar
 * always totals the log.
 */
@customElement('category-time-bar')
export class CategoryTimeBar extends LitElement {
  /** The category under the pointer — over its slice or its legend item. */
  @state()
  private _hovered: string | null = null;

  /** The slice whose readout shows — only slice hover, never legend hover. */
  @state()
  private _tip: string | null = null;

  private _timeline: LanaSettings['timeline'] | null = null;
  private _offLogLoaded: (() => void) | null = null;
  private _offSettings: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    // The inspector paints before the first parse and rebuilds only on a tab
    // change or a selection, so the bar has to follow the log itself.
    this._offLogLoaded = eventBus.on('log:loaded', () => this.requestUpdate());
    // The palette follows the timeline's theme settings live, so a theme change
    // recolours the bar the way it recolours the flame chart.
    this._offSettings = subscribeSettings((settings) => {
      this._timeline = settings.timeline;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    this._offLogLoaded?.();
    this._offLogLoaded = null;
    this._offSettings?.();
    this._offSettings = null;
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

    const color = categoryPalette(this._timeline);
    let x = 0;
    let tipCenter = 0;
    const rects = slices.map((slice) => {
      const width = (slice.selfTime / total) * 100;
      const dim = this._hovered !== null && this._hovered !== slice.category;
      const rect = svg`<rect
        class=${dim ? 'bar__slice bar__slice--dim' : 'bar__slice'}
        x=${x.toFixed(3)} y="0" width=${width.toFixed(3)} height="4"
        fill=${color(slice.category)}
        @pointerenter=${() => {
          this._hovered = slice.category;
          this._tip = slice.category;
        }}
        @pointerleave=${() => {
          this._hovered = null;
          this._tip = null;
        }}
      ></rect>`;
      if (slice.category === this._tip) {
        tipCenter = x + width / 2;
      }
      x += width;
      return rect;
    });
    const tipSlice = this._tip ? slices.find((s) => s.category === this._tip) : undefined;

    return html`
      <div class="chart">
        <svg
          class="bar"
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
          role="img"
          aria-label="Time by category"
        >
          ${rects}
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
                ${tipSlice.category} · ${formatDuration(tipSlice.selfTime)} ·
                ${((tipSlice.selfTime / total) * 100).toFixed(1)}%
              </div>`
            : ''
        }
      </div>
      <div class="legend">
        ${slices.map(
          (slice) => html`
            <span
              class=${classMap({
                legend__item: true,
                'legend__item--active': this._hovered === slice.category,
              })}
              @pointerenter=${() => (this._hovered = slice.category)}
              @pointerleave=${() => (this._hovered = null)}
            >
              <span
                class="legend__swatch"
                style=${styleMap({ background: color(slice.category) })}
              ></span>
              <span>${slice.category}</span>
              <span class="legend__value">
                ${formatDuration(slice.selfTime)} · ${((slice.selfTime / total) * 100).toFixed(1)}%
              </span>
            </span>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'category-time-bar': CategoryTimeBar;
  }
}
