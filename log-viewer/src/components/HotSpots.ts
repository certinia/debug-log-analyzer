/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { formatDuration } from '../core/utility/Util.js';
import {
  getCurrentExecutionHighlights,
  type HotSpotRow,
} from '../features/call-tree/utils/ExecutionHighlights.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../styles/revealRow.styles.js';
import { dispatchInspectorReveal } from './inspectorReveal.js';

/**
 * The signatures with the most self time across the whole log — the ranked
 * hot-spot list every profiler pairs with its call tree. Five rows as a
 * springboard, not a grid: the sortable version is the Analysis tab. Clicking a
 * row selects the signature's most expensive call in the tree.
 */
@customElement('hot-spots')
export class HotSpots extends LitElement {
  /** The list has to follow the log itself. */
  private readonly _logLoaded = new LogLoadedController(this);

  static styles = [globalStyles, inspectorSectionStyles, revealRowStyles];

  render() {
    const highlights = getCurrentExecutionHighlights();
    if (!highlights || !highlights.hotSpots.length) {
      return html`<p class="note">The log has no timed calls.</p>`;
    }

    return html`${highlights.hotSpots.map((spot) => this._spotRow(spot, highlights.totalTime))}`;
  }

  /**
   * One signature: name and self time on the first line, the call count and
   * share of the log beneath, and the share again as a meter. One denominator —
   * the log — across every row, so the meters compare across sections too.
   */
  private _spotRow(spot: HotSpotRow, logTotal: number) {
    const share = logTotal > 0 ? (spot.selfTime / logTotal) * 100 : 0;
    const count = spot.count > 1 ? `${spot.count}× · ` : '';
    return html`
      <button
        class="bleed-row reveal-row"
        type="button"
        title="Show the most expensive call in the tree"
        @click=${() => dispatchInspectorReveal(this, spot.eventIndex)}
      >
        <span class="reveal-row__name" title=${spot.text}>${spot.text}</span>
        <span class="reveal-row__value reveal-row__value--primary"
          >${formatDuration(spot.selfTime)}</span
        >
        <span class="reveal-row__sub">${count}${share.toFixed(1)}% of log</span>
        <span class="reveal-row__meter"
          ><span class="reveal-row__meter-fill" style="width: ${share}%"></span
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
