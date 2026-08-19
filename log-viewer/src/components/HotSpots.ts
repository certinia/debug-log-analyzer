/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { formatDuration } from '../core/utility/Util.js';
import {
  getExecutionHighlights,
  type HotSpotRow,
} from '../features/call-tree/utils/ExecutionHighlights.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../styles/revealRow.styles.js';
import { CategoryPaletteController, categorySwatch } from './categoryTime.js';
import { dispatchInspectorReveal } from './inspectorReveal.js';

/**
 * The signatures with the most self time across the whole log — the ranked
 * hot-spot list every profiler pairs with its call tree. Five rows as a
 * springboard, not a grid: the sortable version is the Analysis tab. Clicking a
 * row selects the signature's most expensive call in the tree.
 */
@customElement('hot-spots')
export class HotSpots extends LitElement {
  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private readonly _palette = new CategoryPaletteController(this);

  static styles = [globalStyles, inspectorSectionStyles, revealRowStyles];

  render() {
    const log = this.logStore?.log;
    const highlights = log && getExecutionHighlights(log);
    if (!highlights || !highlights.hotSpots.length) {
      return html`<p class="note">The log has no timed calls.</p>`;
    }

    return html`${highlights.hotSpots.map((spot) => this._spotRow(spot, highlights.totalTime))}`;
  }

  /**
   * One signature: a swatch, the name and its self time, then the churn read
   * beneath — calls, self time each, share of the log. The meter runs to the
   * total share and its solid head is the self share the sub line names; one
   * denominator, the log, across every row.
   */
  private _spotRow(spot: HotSpotRow, logTotal: number) {
    const share = logTotal > 0 ? (spot.selfTime / logTotal) * 100 : 0;
    const meterShare = logTotal > 0 ? (spot.totalTime / logTotal) * 100 : 0;
    const selfPct = spot.totalTime > 0 ? (spot.selfTime / spot.totalTime) * 100 : 0;
    const churn =
      spot.count > 1
        ? `${spot.count}× · ${formatDuration(spot.selfTime / spot.count)} self avg · `
        : '';
    return html`
      <button
        class="bleed-row reveal-row"
        type="button"
        title="Show the most expensive call in the tree"
        style=${styleMap({
          '--row-hue': this._palette.colorFor(spot.category),
          '--self-pct': `${selfPct}%`,
        })}
        @click=${() => dispatchInspectorReveal(this, spot.eventIndex)}
      >
        ${categorySwatch(spot.category)}
        <span class="reveal-row__name" title=${spot.text}>${spot.text}</span>
        <span class="reveal-row__value reveal-row__value--primary"
          >${formatDuration(spot.selfTime)}</span
        >
        <span class="reveal-row__sub">${churn}${share.toFixed(1)}% of log</span>
        <span class="reveal-row__meter"
          ><span class="reveal-row__meter-fill" style="width: ${meterShare}%"></span
        ></span>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hot-spots': HotSpots;
  }
}
