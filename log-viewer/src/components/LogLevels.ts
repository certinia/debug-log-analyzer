/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type { DebugLevel } from 'apex-log-parser';

// web components
import '#vscode-elements/vscode-icon.js';
import './Divider.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

import { computeVisibleCount } from './logLevelsOverflow.js';

/** Space reserved for the overflow button when the row can't fit every item (px). */
const OVERFLOW_RESERVE = 56;
/** Gap between chips, in px — the source of truth for both the `.items` CSS gap and the fit math. */
const ITEMS_GAP = 6;
/** Shared by the overflow button's `popovertarget` and the panel's `id` — must match. */
const PANEL_ID = 'log-levels-panel';

/**
 * Read-only display of the log's captured debug levels in the app header: one chip per
 * category (`CATEGORY LEVEL`), styled as a VS Code dropdown face (no chevron). As width
 * shrinks, chips hide from the right one-by-one behind an overflow button (pinned
 * hard-right) that reveals the hidden chips in a menu panel — updated live on resize.
 *
 * This is display only — filtering is not wired yet. When it is, these chips become
 * interactive level dropdowns (see `_renderItem`).
 *
 * Chips stay mounted; overflow is hidden via CSS (never unmounted). How-many-fit is
 * computed synchronously from cached chip widths on each resize, so the bar + overflow
 * control update live during a drag (no async measure pass that blanks the row).
 */
@customElement('log-levels')
export class LogLevels extends LitElement {
  @property()
  logSettings: DebugLevel[] | null = null;

  /** How many leading items fit inline; the rest are CSS-hidden and shown in the panel. */
  @state()
  private visibleCount = Number.POSITIVE_INFINITY;

  private resizeObserver?: ResizeObserver;
  private lastWidth = -1;
  /** Per-chip widths (px), measured once with all chips visible; drives sync overflow. */
  private itemWidths: number[] | null = null;

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        font-size: 11px;
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
      }

      /* Items take the remaining space and clip; the overflow button is pushed hard-right. */
      .items {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: ${ITEMS_GAP}px;
        min-width: 0;
        overflow: hidden;
        flex: 1 1 auto;
      }

      /* Matches the resting vscode-single-select face exactly (same tokens / 4px radius / 1px
         border), so when filtering lands this chip gains a chevron + interactivity to become
         that dropdown. */
      .lvl {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 6px;
        border: 1px solid var(--vscode-settings-dropdownBorder, #3c3c3c);
        border-radius: 4px;
        background-color: var(--vscode-settings-dropdownBackground, #313131);
        white-space: nowrap;
        flex: 0 0 auto;
      }

      .lvl.is-hidden {
        display: none;
      }

      .lvl__cat {
        font-size: 10px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }

      .lvl__val {
        font-family: var(--vscode-editor-font-family, monospace);
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      /* Short rule separating the display chips from the interactive overflow control. */
      .sep {
        height: 16px;
        margin: 0 2px;
        flex: 0 0 auto;
      }

      /* The one interactive control in the row: same dropdown-face chip as the levels, but
         with a count + chevron (the chevron marks it, and only it, as clickable). */
      .overflow {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border: 1px solid var(--vscode-settings-dropdownBorder, #3c3c3c);
        border-radius: 4px;
        background-color: var(--vscode-settings-dropdownBackground, #313131);
        color: var(--vscode-foreground);
        font: inherit;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        flex: 0 0 auto;
        anchor-name: --log-levels-overflow;
      }

      .overflow:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .overflow:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      .overflow__count {
        font-weight: 600;
      }

      .overflow__chevron {
        color: var(--vscode-descriptionForeground);
        transition: transform 120ms ease;
      }

      /* Native popover drives open/close; :has() flips the chevron while it's shown. */
      .container:has([popover]:popover-open) .overflow__chevron {
        transform: rotate(180deg);
      }

      @media (prefers-reduced-motion: reduce) {
        .overflow__chevron {
          transition: none;
        }
      }

      /* Native-menu chrome for the pop-out. Top-layer popover, anchored bottom-right to
         the overflow button (escapes the header's overflow-x: clip). */
      .panel {
        position: fixed;
        position-anchor: --log-levels-overflow;
        position-area: bottom span-left;
        inset: auto;
        margin: 6px 0 0 0;
        min-width: 200px;
        max-width: min(92vw, 340px);
        padding: 6px;
        background-color: var(--vscode-menu-background, var(--vscode-editor-background));
        border: 1px solid var(--vscode-menu-border, var(--divider-background));
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        color: var(--vscode-menu-foreground, var(--vscode-foreground));
        font-family: var(--vscode-font-family);
      }

      .panel__head {
        padding: 2px 10px 6px;
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-foreground);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 4px 10px;
        border-radius: 4px;
      }

      .row__cat {
        color: var(--vscode-descriptionForeground);
      }

      .row__val {
        font-family: var(--vscode-editor-font-family, monospace);
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .item-skeleton {
        width: 92px;
        height: 18px;
        border-radius: 4px;
        flex: 0 0 auto;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    // Re-measure once webview fonts finish loading (chip widths can shift).
    void document.fonts?.ready.then(() => {
      this._resetMeasurement();
      this.requestUpdate();
    });
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width === this.lastWidth) {
        return;
      }
      this.lastWidth = width;
      // Synchronous recompute from cached widths → live overflow on every resize frame.
      if (this.itemWidths) {
        this._recompute(width);
      } else {
        this.requestUpdate(); // no cache yet → trigger the initial measure in updated()
      }
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  /** Drop cached widths and show every chip, so the next render can re-measure them. */
  private _resetMeasurement(): void {
    this.itemWidths = null;
    this.visibleCount = Number.POSITIVE_INFINITY;
    // Nothing is hidden until re-measured, so the overflow button (and its popover)
    // unmount — the native popover closes itself when its invoker leaves the DOM.
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('logSettings') && this.logSettings) {
      this._resetMeasurement();
    }
  }

  protected updated(): void {
    if (this.itemWidths || !this.logSettings) {
      return;
    }
    const items = this.renderRoot.querySelector<HTMLElement>('.items');
    const cells = items ? [...items.querySelectorAll<HTMLElement>('.lvl')] : [];
    if (!cells.length) {
      return;
    }
    // Plain spans render synchronously, so offsetWidth is accurate here (no rAF needed).
    this.itemWidths = cells.map((el) => el.offsetWidth);
    this._recompute(items!.clientWidth);
  }

  /** Set `visibleCount` = how many leading chips fit in `avail` px, from cached widths. */
  private _recompute(avail: number): void {
    const widths = this.itemWidths;
    if (!widths) {
      return;
    }
    this.visibleCount = computeVisibleCount(widths, avail, ITEMS_GAP, OVERFLOW_RESERVE);
  }

  render() {
    if (!this.logSettings) {
      return html`<div class="bar">
        <div class="items">
          ${repeat(
            Array.from({ length: 6 }),
            (_, i) => i,
            () => html`<div class="item-skeleton skeleton"></div>`,
          )}
        </div>
      </div>`;
    }

    const total = this.logSettings.length;
    const visible = Math.min(this.visibleCount, total);
    const hiddenItems = this.logSettings.slice(visible);
    const hiddenCount = hiddenItems.length;
    const hasOverflow = hiddenCount > 0;

    return html`<div class="container">
      <div class="bar">
        <div class="items">
          ${repeat(
            this.logSettings,
            (s) => s.logCategory,
            (s, i) => this._renderItem(s, i >= visible),
          )}
        </div>
        ${
          hasOverflow
            ? html`<divider-line orientation="vertical" class="sep"></divider-line>
                <button
                  class="overflow"
                  popovertarget=${PANEL_ID}
                  aria-haspopup="true"
                  title="Show ${hiddenCount} more log level${hiddenCount === 1 ? '' : 's'}"
                >
                  <span class="overflow__count">+${hiddenCount}</span>
                  <vscode-icon
                    name="chevron-down"
                    class="overflow__chevron"
                    size="14"
                  ></vscode-icon>
                </button>`
            : ''
        }
      </div>
      ${
        hasOverflow
          ? html`<div class="panel" id=${PANEL_ID} popover>
              <div class="panel__head">Log levels</div>
              ${repeat(
                hiddenItems,
                (s) => s.logCategory,
                (s) => this._renderRow(s),
              )}
            </div>`
          : ''
      }
    </div>`;
  }

  /**
   * MIGRATION TO FILTERS: each item is a read-only chip styled as a VS Code dropdown face
   * (no chevron). To make levels filterable, this is the only render seam that changes:
   *   1. swap the `.lvl` chip for `<vs-select compact>` (chevron returns) — both here and in
   *      `_renderRow` (the overflow panel is the controls' second home);
   *   2. reintroduce level ordering + ceiling helpers (removed `logLevelsFormat.ts`:
   *      `LEVEL_ORDER`/`rankOf`/`ceilingHint`) and the `VsSelect` compact + disabled-option
   *      tooltip additions;
   *   3. add a `filters` Map (per-category chosen level) + a `@change` handler that emits
   *      `log-levels-change`, and have views subscribe to hide events above the threshold.
   * The category/level markup stays the same, so overflow measurement + alignment are unaffected.
   */
  private _renderItem(setting: DebugLevel, hidden: boolean): TemplateResult {
    return html`<span class="lvl ${hidden ? 'is-hidden' : ''}">
      <span class="lvl__cat">${setting.logCategory}</span>
      <span class="lvl__val">${setting.logLevel}</span>
    </span>`;
  }

  private _renderRow(setting: DebugLevel): TemplateResult {
    return html`<div class="row">
      <span class="row__cat">${setting.logCategory}</span>
      <span class="row__val">${setting.logLevel}</span>
    </div>`;
  }
}
