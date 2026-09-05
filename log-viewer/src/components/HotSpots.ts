/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { formatDuration, sharePercent } from '../core/utility/Util.js';
import {
  getExecutionHighlights,
  type HotSpotRow,
} from '../features/call-tree/utils/ExecutionHighlights.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../styles/revealRow.styles.js';
import { CategoryPaletteController, categoryLabel } from './categoryTime.js';
import { dispatchInspectorReveal } from './inspectorReveal.js';
import { revealRowMeter, revealRowTitle } from './revealRowMeter.js';

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
   * One signature: the name and its self time, then the churn read
   * beneath — calls, self time each, share of the log, and the time in the calls
   * below it, which nothing else on the row gives in text. The meter runs to the
   * total share and its solid head is the self share the sub line names, with a
   * hover target per part; one denominator, the log, across every row.
   */
  private _spotRow(spot: HotSpotRow, logTotal: number) {
    const share = sharePercent(spot.selfTime, logTotal);
    const meterShare = sharePercent(spot.totalTime, logTotal);
    const below = spot.totalTime - spot.selfTime;
    const title = revealRowTitle(
      spot,
      below > 0 ? `${formatDuration(below)} in the calls below` : '',
    );
    const churn =
      spot.count > 1
        ? `${spot.count}× · ${formatDuration(spot.selfTime / spot.count)} self avg · `
        : '';
    const sub = `${churn}${share.toFixed(1)}% of log${below > 0 ? ` · ${formatDuration(below)} below` : ''}`;
    return html`
      <button
        class="bleed-row reveal-row"
        type="button"
        title=${title}
        style=${styleMap({
          '--row-hue': this._palette.colorFor(spot.category),
          '--self-pct': `${sharePercent(spot.selfTime, spot.totalTime)}%`,
        })}
        @click=${() => dispatchInspectorReveal(this, spot.eventIndex)}
      >
        ${categoryLabel(spot.category)}
        <span class="reveal-row__name" title=${spot.text}>${spot.text}</span>
        <span class="reveal-row__value reveal-row__value--primary"
          >${formatDuration(spot.selfTime)}</span
        >
        <span class="reveal-row__sub">${sub}</span>
        ${revealRowMeter(
          meterShare,
          [
            { share, title: `self ${formatDuration(spot.selfTime)}` },
            { share: meterShare - share, title: `${formatDuration(below)} in the calls below` },
          ],
          title,
        )}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hot-spots': HotSpots;
  }
}
