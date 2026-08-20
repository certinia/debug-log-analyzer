/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { CategoryPaletteController, categoryName } from '../../../components/categoryTime.js';
import { dispatchInspectorReveal } from '../../../components/inspectorReveal.js';
import { logContext } from '../../../core/log/logContext.js';
import type { LogStore } from '../../../core/log/LogStore.js';
import { formatDuration, formatInteger } from '../../../core/utility/Util.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { inspectorSectionStyles } from '../../../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../../../styles/revealRow.styles.js';
import {
  CONCENTRATION_PERCENT,
  binAt,
  binRange,
  getSelfTimeSpread,
  type SingleRow,
  type SpreadRow,
} from '../services/SelfTimeSpread.js';

/** Where a reading sits along a lane, whose scale runs from no time to the worst call. */
function tickPercent(value: number, max: number): number {
  return (value / max) * 100;
}

/**
 * How the log's self time spreads: one histogram of per-call self time for each
 * of the busiest repeated signatures, the biggest one-off calls named beneath
 * them, headed by how few signatures the log comes down to.
 * The Analysis grid ranks by count and average, so an average is all it can give;
 * only the shape says whether every call is slow or one call is. Clicking a lane
 * selects the signature's worst call in the grid.
 */
@customElement('self-time-spread')
export class SelfTimeSpreadView extends LitElement {
  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private readonly _palette = new CategoryPaletteController(this);

  /** The bin under the pointer, so the lane names what it is showing. */
  @state() private _hovered: { eventIndex: number; bin: number } | null = null;

  /**
   * A lane is a histogram of one signature's calls: the bins run from no self
   * time to the signature's worst call, so a lane is read against its own scale
   * and the tallest bin is where the calls really sit. Bin heights and tick
   * positions arrive inline, and the row's category hue as `--row-hue`, so these
   * rules stay static.
   */
  static styles = [
    globalStyles,
    inspectorSectionStyles,
    revealRowStyles,
    css`
      .summary {
        margin-bottom: var(--lana-space-2xs);
        color: var(--lana-fg-muted);
        white-space: normal;
      }

      /* Names the form of the rows under it: a histogram needs more than one call,
         so the one-off calls are grouped apart from the lanes. */
      .group {
        margin: var(--lana-space-2xs) 0 var(--lana-space-3xs);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-caps);
        letter-spacing: var(--lana-text-caps-tracking);
        text-transform: uppercase;
      }

      /* Full width beneath the row's readings. The baseline is the axis, tinted from
         the row's own hue so it belongs to the lane in either theme. */
      .spread {
        display: flex;
        align-items: flex-end;
        gap: var(--lana-stroke);
        grid-column: 1 / -1;
        position: relative;
        height: var(--lana-space-md);
        border-bottom: var(--lana-stroke) solid color-mix(in srgb, var(--row-hue) 30%, transparent);
      }

      .spread__bin {
        flex: 1 1 0;
        min-width: 0;
        border-radius: var(--lana-radius-sm) var(--lana-radius-sm) 0 0;
        background: color-mix(in srgb, var(--row-hue) 55%, transparent);
      }

      /* The bin the sub line is reading out. */
      .spread__bin--hovered {
        background: var(--row-hue);
      }

      /* The median and the 95th call, over the bins they explain: where half the
         calls sit, and where the slow tail starts. */
      .spread__tick {
        position: absolute;
        inset-block: 0;
        width: var(--lana-stroke);
        transform: translateX(-50%);
        background: var(--lana-fg-muted);
      }

      .spread__tick--p95 {
        background: color-mix(in srgb, var(--lana-fg-muted) 50%, transparent);
      }
    `,
  ];

  willUpdate(changed: PropertyValues<this>) {
    // A hovered bin belongs to the log it was read from.
    if (changed.has('logStore')) {
      this._hovered = null;
    }
  }

  render() {
    const log = this.logStore?.log;
    const spread = log && getSelfTimeSpread(log);
    if (!spread?.concentration) {
      return html`<p class="note">The log has no timed calls.</p>`;
    }

    const { signatures, total } = spread.concentration;
    return html`
      <div class="summary">
        ${CONCENTRATION_PERCENT}% of self time in ${formatInteger(signatures)} of
        ${formatInteger(total)} signatures
      </div>
      ${
        spread.lanes.length
          ? html`<div class="group">Repeated</div> ${spread.lanes.map((row) => this._laneRow(row))}`
          : ''
      }
      ${
        spread.singles.length
          ? html`<div class="group">Ran once</div>
              ${spread.singles.map((row) => this._singleRow(row))}`
          : ''
      }
    `;
  }

  /**
   * The shell every row shares: the category hue, the name that truncates, the
   * headline time, and whatever the row adds beneath them.
   */
  private _row(row: SingleRow, title: string, value: number, extras: TemplateResult | '') {
    return html`
      <button
        class="bleed-row reveal-row reveal-row--no-swatch"
        type="button"
        title=${title}
        style=${styleMap({ '--row-hue': this._palette.colorFor(row.category) })}
        @click=${() => dispatchInspectorReveal(this, row.eventIndex)}
      >
        <!-- The hue is decorative, so the category it stands for is spoken here. -->
        <span class="reveal-row__sr">${categoryName(row.category)}</span>
        <span class="reveal-row__name" title=${row.text}>${row.text}</span>
        <span class="reveal-row__value reveal-row__value--primary">${formatDuration(value)}</span>
        ${extras}
      </button>
    `;
  }

  /**
   * A call the log made once. One call has no shape, so the row gives the time it
   * cost and nothing else: the lanes above are what the histogram form is for.
   */
  private _singleRow(row: SingleRow) {
    return this._row(row, `1 timed call · self ${formatDuration(row.selfTime)}`, row.selfTime, '');
  }

  /**
   * One signature: the self time it holds to the right, the readings that place
   * it beneath, and the histogram of its calls under both. The lane itself runs
   * from no time to the worst call, so the tallest bin is where the calls really
   * sit and a bin out to the right is the call worth opening.
   */
  private _laneRow(row: SpreadRow) {
    const title = [
      `${formatInteger(row.count)} timed calls`,
      `self ${formatDuration(row.selfTime)}`,
      `median ${formatDuration(row.median)}`,
      `95th ${formatDuration(row.p95)}`,
      `worst ${formatDuration(row.max)}`,
    ].join(' · ');
    const hovered = this._hovered?.eventIndex === row.eventIndex ? this._hovered.bin : null;
    return this._row(
      row,
      title,
      row.selfTime,
      html`
        <span class="reveal-row__sub">${this._subLine(row, hovered)}</span>
        ${this._histogram(row, hovered)}
      `,
    );
  }

  /** The readings, or what the pointer is over while it crosses the lane. */
  private _subLine(row: SpreadRow, hovered: number | null) {
    if (hovered !== null) {
      const [from, to] = binRange(row.max, hovered);
      const calls = row.bins[hovered] ?? 0;
      const what = calls === 1 ? '1 call' : `${formatInteger(calls)} calls`;
      return `${what} · ${formatDuration(from)} to ${formatDuration(to)}`;
    }
    return `${formatInteger(row.count)} timed calls · med ${formatDuration(row.median)} · p95 ${formatDuration(row.p95)}`;
  }

  /** The calls bucketed over `0..max`, with the median and the 95th call marked. */
  private _histogram(row: SpreadRow, hovered: number | null) {
    return html`
      <span
        class="spread"
        aria-hidden="true"
        @pointermove=${(event: PointerEvent) => this._onPointerMove(event, row)}
        @pointerleave=${() => (this._hovered = null)}
      >
        ${row.heights.map(
          (height, index) =>
            html`<span
              class="spread__bin ${index === hovered ? 'spread__bin--hovered' : ''}"
              style="height: ${height}%"
            ></span>`,
        )}
        <span class="spread__tick" style="left: ${tickPercent(row.median, row.max)}%"></span>
        <span
          class="spread__tick spread__tick--p95"
          style="left: ${tickPercent(row.p95, row.max)}%"
        ></span>
      </span>
    `;
  }

  /** The bin under the pointer, read from where it sits across the lane. */
  private _onPointerMove(event: PointerEvent, row: SpreadRow) {
    const lane = event.currentTarget as HTMLElement;
    const box = lane.getBoundingClientRect();
    const bin = binAt((event.clientX - box.left) / box.width);
    if (this._hovered?.eventIndex === row.eventIndex && this._hovered.bin === bin) {
      return;
    }
    this._hovered = { eventIndex: row.eventIndex, bin };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'self-time-spread': SelfTimeSpreadView;
  }
}
