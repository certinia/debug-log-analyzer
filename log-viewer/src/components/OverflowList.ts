/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// web components
import '#vscode-elements/vscode-icon.js';
import './Divider.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

import { computeVisibleCount } from './overflowFit.js';

/** Space reserved for the overflow toggle once the row can't fit every item (px). */
const OVERFLOW_RESERVE = 56;
/** Gap between items, in px — the source of truth for both the `.items` CSS gap and the fit math. */
const ITEMS_GAP = 6;
/** Shared by the toggle's `popovertarget`/`aria-controls` and the panel's `id` — must match. */
const PANEL_ID = 'overflow-list-panel';

/**
 * Slot-based responsive overflow row (a.k.a. Priority+ navigation): renders slotted children
 * inline, and as width shrinks collapses the ones that don't fit behind a `+N` toggle that
 * reveals them in a native popover menu — updated live on resize.
 *
 * Slotted children are the items. Because an element can occupy only one slot, overflowing
 * children are *moved* into the popover (via `slot="overflow"`) rather than duplicated, so
 * the menu shows exactly the hidden items. How-many-fit is computed synchronously from cached
 * child widths (measured once, all inline), so the row updates live during a drag with no
 * reflow loop.
 *
 * API mirrors Blueprint/Mantine `OverflowList`: `collapse-from`, `min-visible`, `menu-heading`.
 * `part="toggle"`/`part="menu"` expose the control + panel for external styling.
 */
@customElement('overflow-list')
export class OverflowList extends LitElement {
  /** Popover title and panel `aria-label`. */
  @property({ attribute: 'menu-heading' })
  menuHeading = '';

  /** Which end collapses into the menu. Static per instance. */
  @property({ attribute: 'collapse-from' })
  collapseFrom: 'end' | 'start' = 'end';

  /** Never collapse this many items, even if they clip. */
  @property({ attribute: 'min-visible', type: Number })
  minVisible = 0;

  /** How many items fit inline; the rest are moved into the popover menu. */
  @state()
  private visibleCount = Number.POSITIVE_INFINITY;

  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private lastWidth = -1;
  /** Per-item widths (px), measured once with all items inline; drives sync overflow. */
  private itemWidths: number[] | null = null;

  static styles = [
    globalStyles,
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

      /* Items take the remaining space and clip; the toggle is pushed to the collapse end. */
      .items {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: ${ITEMS_GAP}px;
        min-width: 0;
        overflow: hidden;
        flex: 1 1 auto;
      }

      /* Short rule separating the items from the interactive toggle. */
      .sep {
        height: 16px;
        margin: 0 2px;
        flex: 0 0 auto;
      }

      /* The one interactive control: a dropdown-face chip with a count + chevron. */
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
        anchor-name: --overflow-list-toggle;
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

      /* Native-menu chrome for the pop-out. Top-layer popover anchored to the toggle
         (escapes any ancestor overflow clip); side follows collapse-from. */
      .panel {
        position: fixed;
        position-anchor: --overflow-list-toggle;
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

      .container.end .panel {
        position-area: bottom span-left;
      }

      .container.start .panel {
        position-area: bottom span-right;
      }

      .panel__head {
        padding: 2px 10px 6px;
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-foreground);
      }

      .menu-items {
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: flex-start;
        padding: 0 4px 2px;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    // Re-measure once webview fonts finish loading (item widths can shift).
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
    // Items are light-DOM children, not a reactive property, so watch for set changes here.
    this.mutationObserver = new MutationObserver(() => {
      this._resetMeasurement();
      this.requestUpdate();
    });
    this.mutationObserver.observe(this, { childList: true });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
  }

  /** Drop cached widths and show every item, so the next render can re-measure them. */
  private _resetMeasurement(): void {
    this.itemWidths = null;
    this.visibleCount = Number.POSITIVE_INFINITY;
    for (const child of this.children) {
      child.removeAttribute('slot'); // all inline for the re-measure pass
    }
  }

  protected updated(changed: PropertyValues): void {
    // The MutationObserver reset is async; if a reactive update lands first after a child
    // add/remove, drop the now-stale width cache here so this pass re-measures.
    if (this.itemWidths && this.itemWidths.length !== this.childElementCount) {
      this.itemWidths = null;
    }
    if (!this.itemWidths) {
      this._measure();
    } else if (changed.has('collapseFrom') || changed.has('minVisible')) {
      this._recompute(this.lastWidth);
    }
  }

  /** Measure every item's natural width (all inline), cache it, then compute the fit. */
  private _measure(): void {
    const items = this.renderRoot.querySelector<HTMLElement>('.items');
    const children = [...this.children] as HTMLElement[];
    if (!items || !children.length) {
      return;
    }
    for (const child of children) {
      child.removeAttribute('slot');
    }
    // Custom elements upgrade synchronously (defined before use), so offsetWidth is accurate.
    this.itemWidths = children.map((el) => el.offsetWidth);
    this.lastWidth = items.clientWidth;
    this._recompute(this.lastWidth);
  }

  /** Set `visibleCount` from cached widths + `collapse-from`/`min-visible`, then re-slot. */
  private _recompute(avail: number): void {
    const widths = this.itemWidths;
    if (!widths || avail < 0) {
      return;
    }
    // Fit the visible run from the appropriate end (reverse for start-collapse).
    const ordered = this.collapseFrom === 'start' ? [...widths].reverse() : widths;
    const fit = computeVisibleCount(ordered, avail, ITEMS_GAP, OVERFLOW_RESERVE);
    this.visibleCount = Math.max(fit, Math.min(this.minVisible, widths.length));
    this._applyOverflow();
  }

  /** Move the hidden children into the overflow slot; keep the visible ones inline. */
  private _applyOverflow(): void {
    const total = this.childElementCount;
    const visible = Math.min(this.visibleCount, total);
    const hidden = total - visible;
    const children = [...this.children];
    children.forEach((child, i) => {
      const isHidden = this.collapseFrom === 'end' ? i >= visible : i < hidden;
      if (isHidden) {
        child.setAttribute('slot', 'overflow');
      } else {
        child.removeAttribute('slot');
      }
    });
  }

  render() {
    const total = this.childElementCount;
    const hiddenCount = total - Math.min(this.visibleCount, total);
    const fromStart = this.collapseFrom === 'start';
    const sep = html`<divider-line orientation="vertical" class="sep"></divider-line>`;
    const button = html`<button
      part="toggle"
      class="overflow"
      popovertarget=${PANEL_ID}
      aria-haspopup="true"
      aria-controls=${PANEL_ID}
      title="Show ${hiddenCount} more"
    >
      <span class="overflow__count">+${hiddenCount}</span>
      <vscode-icon name="chevron-down" class="overflow__chevron" size="14"></vscode-icon>
    </button>`;
    // Toggle pins to the collapse end, with the divider always adjacent to the items.
    const toggle =
      hiddenCount > 0 ? (fromStart ? html`${button}${sep}` : html`${sep}${button}`) : '';

    return html`<div class="container ${this.collapseFrom}">
      <div class="bar">
        ${fromStart ? toggle : ''}
        <div class="items"><slot></slot></div>
        ${fromStart ? '' : toggle}
      </div>
      ${
        hiddenCount > 0
          ? html`<div
              part="menu"
              class="panel"
              id=${PANEL_ID}
              popover
              role="group"
              aria-label=${this.menuHeading}
            >
              ${this.menuHeading ? html`<div class="panel__head">${this.menuHeading}</div>` : ''}
              <div class="menu-items"><slot name="overflow"></slot></div>
            </div>`
          : ''
      }
    </div>`;
  }
}
