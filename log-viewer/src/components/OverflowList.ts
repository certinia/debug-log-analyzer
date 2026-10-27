/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// web components
import '#vscode-elements/vscode-icon.js';
import './Divider.js';

// styles
import { anchoredPopoverStyles } from '../styles/anchoredPopover.styles.js';
import { globalStyles } from '../styles/global.styles.js';

import { computeVisibleCount } from './overflowFit.js';

/** Space reserved for the overflow toggle once the row can't fit every item (px). */
export const OVERFLOW_RESERVE = 56;
/** Shared by the toggle's `popovertarget`/`aria-controls` and the panel's `id` — must match. */
const PANEL_ID = 'overflow-list-panel';
/** Gap between the items, the toggle and the `end` slot (px). */
const BAR_GAP = 6;

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
 * Children with `slot="end"` never collapse: they sit after the toggle, and the items no
 * longer stretch, so the toggle and those controls follow the last visible item. An `end`
 * child marked `collapse-last` may shrink to its `min-width`; past that it moves into the
 * menu too, after every item.
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

  /** Codicon shown on the toggle. Default chevron (rotates on open); e.g. `filter`
   *  for a filters overflow — a non-chevron icon does not rotate. */
  @property({ attribute: 'icon' })
  icon = 'chevron-down';

  /** Gap between inline items (px) — drives both the row layout and the fit math. */
  @property({ type: Number })
  gap = 6;

  /** How many items fit inline; the rest are moved into the popover menu. */
  @state()
  private visibleCount = Number.POSITIVE_INFINITY;

  @state()
  private hasEnd = false;

  /** The `collapse-last` children are in the menu. */
  @state()
  private endCollapsed = false;

  private resizeObserver?: ResizeObserver;
  private childResizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private lastWidth = -1;
  /** Per-item widths (px), measured once with all items inline; drives sync overflow. */
  private itemWidths: number[] | null = null;

  static styles = [
    globalStyles,
    anchoredPopoverStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        font-size: var(--lana-text-base);
      }

      .bar {
        display: flex;
        align-items: center;
        gap: ${unsafeCSS(BAR_GAP)}px;
        width: 100%;
      }

      /* Items take the remaining space and clip; the toggle is pushed to the collapse end.
         The margin leaves room for an item's focus ring. Chromium drops a calc() there,
         so it takes a plain length that covers ring plus offset. */
      .items {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        min-width: 0;
        overflow: clip;
        overflow-clip-margin: var(--lana-space-2xs);
        flex: 1 1 auto;
      }

      /* With trailing controls, the toggle and those controls follow the last item. */
      .bar.has-end .items {
        flex: 0 1 auto;
      }

      ::slotted([slot='end']) {
        flex: 0 0 auto;
      }

      /* Short rule separating the items from the interactive toggle. */
      .sep {
        height: 16px;
        margin: 0 var(--lana-space-3xs);
        flex: 0 0 auto;
      }

      /* The one interactive control: a dropdown-face chip with a count + chevron. */
      .overflow {
        display: inline-flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        padding: var(--lana-space-3xs) var(--lana-space-xs);
        border: var(--lana-stroke) solid var(--lana-control-border);
        border-radius: var(--lana-radius-sm);
        background-color: var(--lana-control-bg);
        color: var(--lana-fg);
        font: inherit;
        font-size: var(--lana-text-base);
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        flex: 0 0 auto;
        anchor-name: --overflow-list-toggle;
      }

      .overflow:hover {
        background-color: var(--lana-row-hover-bg);
      }

      .overflow:focus-visible {
        outline: var(--lana-focus-ring);
        outline-offset: var(--lana-focus-offset);
      }

      .overflow__count {
        font-weight: 600;
      }

      .overflow__chevron {
        color: var(--lana-fg-muted);
        transition: transform 120ms ease;
      }

      /* Native popover drives open/close; :has() flips the chevron while it's shown.
         Only the default chevron rotates — a filter/other icon stays put. */
      .container:has([popover]:popover-open) .overflow__chevron--rotate {
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
        position-anchor: --overflow-list-toggle;
        margin: var(--lana-space-xs) 0 0 0;
        min-width: 200px;
        max-width: min(92vw, 340px);
        box-sizing: border-box;
        /* Bounded by the window, not the pane: like any menu it may cover a docked panel. */
        max-height: min(540px, 90vh);
        overflow-y: auto;
        padding: var(--lana-space-xs);
      }

      .container.end .panel {
        position-area: bottom span-left;
      }

      .container.start .panel {
        position-area: bottom span-right;
      }

      .panel__head {
        padding: var(--lana-space-3xs) 10px var(--lana-space-xs);
        font-weight: 600;
        font-size: var(--lana-text-base);
        color: var(--lana-fg);
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
      this._fitEnd(entries[0]?.contentRect.width ?? 0);
      const width = (entries[0]?.contentRect.width ?? 0) - this._endWidth();
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
    // A child can change its own width without any host resize or childList change
    // (e.g. a filter pill's label ↔ "label: min–max" summary, inside its shadow DOM).
    // Re-measure when an INLINE child's width diverges from the cached value. Items in
    // the overflow slot are skipped so slot reassignment can't feed back into a loop.
    this.childResizeObserver = new ResizeObserver(() => {
      if (!this.itemWidths) {
        return;
      }
      const children = this._items();
      const stale = children.some(
        (el, i) =>
          el.getAttribute('slot') !== 'overflow' &&
          this.itemWidths !== null &&
          el.offsetWidth !== this.itemWidths[i],
      );
      if (stale) {
        this._resetMeasurement();
        this.requestUpdate();
      }
    });
    // Items are light-DOM children, not a reactive property, so watch for set changes here.
    this.mutationObserver = new MutationObserver(() => {
      this._observeChildren();
      this._resetMeasurement();
      this.requestUpdate();
    });
    this.mutationObserver.observe(this, { childList: true });
    this._observeChildren();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.childResizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
  }

  /** (Re)point the per-child ResizeObserver at the current child set. */
  private _observeChildren(): void {
    this.childResizeObserver?.disconnect();
    for (const child of this.children) {
      this.childResizeObserver?.observe(child);
    }
  }

  /** The children that collapse: every child but the `end` slot's. */
  private _items(): HTMLElement[] {
    return ([...this.children] as HTMLElement[]).filter(
      (el) => el.slot !== 'end' && !el.hasAttribute('collapse-last'),
    );
  }

  private _collapseLast(): HTMLElement[] {
    return ([...this.children] as HTMLElement[]).filter((el) => el.hasAttribute('collapse-last'));
  }

  /** Moves the `collapse-last` children into the menu once the toggle and their `min-width` no longer fit. */
  private _fitEnd(hostWidth: number): void {
    const last = this._collapseLast();
    if (!last.length) {
      this.endCollapsed = false;
      return;
    }
    if (!hostWidth) {
      return;
    }
    const min = last.reduce(
      (sum, el) => sum + (parseFloat(getComputedStyle(el).minWidth) || el.offsetWidth) + BAR_GAP,
      0,
    );
    this.endCollapsed = hostWidth < OVERFLOW_RESERVE + min;
    for (const el of last) {
      el.setAttribute('slot', this.endCollapsed ? 'overflow' : 'end');
    }
  }

  /** The `end` slot's width plus the gap before it. */
  private _endWidth(): number {
    return ([...this.children] as HTMLElement[])
      .filter((el) => el.slot === 'end')
      .reduce((sum, el) => sum + el.offsetWidth + BAR_GAP, 0);
  }

  /** Drop cached widths and show every item, so the next render can re-measure them. */
  private _resetMeasurement(): void {
    this.itemWidths = null;
    this.visibleCount = Number.POSITIVE_INFINITY;
    for (const child of this._items()) {
      child.removeAttribute('slot'); // all inline for the re-measure pass
    }
  }

  protected updated(changed: PropertyValues): void {
    // The MutationObserver reset is async; if a reactive update lands first after a child
    // add/remove, drop the now-stale width cache here so this pass re-measures.
    if (this.itemWidths && this.itemWidths.length !== this._items().length) {
      this.itemWidths = null;
    }
    if (!this.itemWidths) {
      this._measure();
    } else if (changed.has('collapseFrom') || changed.has('minVisible') || changed.has('gap')) {
      this._recompute(this.lastWidth);
    }
  }

  /** Measure every item's natural width (all inline), cache it, then compute the fit. */
  private _measure(): void {
    // A child arriving resizes nothing, so the observer would not place a new `collapse-last` one.
    this._fitEnd(this.clientWidth);
    const items = this.renderRoot.querySelector<HTMLElement>('.items');
    const children = this._items();
    if (!items || !children.length) {
      return;
    }
    // Every item goes into the menu with it, and the toggle would leave the items no width to measure.
    if (this.endCollapsed) {
      this.visibleCount = 0;
      this._applyOverflow();
      return;
    }
    for (const child of children) {
      child.removeAttribute('slot');
    }
    // Hidden (e.g. mounted in an inactive tab panel): every offsetWidth is 0,
    // which would cache as "everything fits" and never collapse. Defer without
    // caching — the ResizeObserver fires on reveal (0 → width) and re-measures.
    const avail = items.clientWidth;
    if (avail === 0) {
      return;
    }
    // Custom elements upgrade synchronously (defined before use), so offsetWidth is accurate.
    this.itemWidths = children.map((el) => el.offsetWidth);
    this.lastWidth = avail;
    this._recompute(avail);
  }

  /** Set `visibleCount` from cached widths + `collapse-from`/`min-visible`, then re-slot. */
  private _recompute(avail: number): void {
    const widths = this.itemWidths;
    if (!widths || avail < 0) {
      return;
    }
    // Fit the visible run from the appropriate end (reverse for start-collapse).
    const ordered = this.collapseFrom === 'start' ? [...widths].reverse() : widths;
    const fit = computeVisibleCount(ordered, avail, this.gap, OVERFLOW_RESERVE);
    this.visibleCount = this.endCollapsed
      ? 0
      : Math.max(fit, Math.min(this.minVisible, widths.length));
    this._applyOverflow();
  }

  private _onEndChange(event: Event): void {
    this.hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
  }

  /** Move the hidden children into the overflow slot; keep the visible ones inline. */
  private _applyOverflow(): void {
    const children = this._items();
    const total = children.length;
    const visible = Math.min(this.visibleCount, total);
    const hidden = total - visible;
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
    const total = this._items().length;
    const hiddenItems = total - Math.min(this.visibleCount, total);
    const hiddenCount = hiddenItems + (this.endCollapsed ? this._collapseLast().length : 0);
    const fromStart = this.collapseFrom === 'start';
    const sep =
      hiddenItems < total
        ? html`<divider-line orientation="vertical" class="sep"></divider-line>`
        : '';
    const button = html`<button
      part="toggle"
      class="overflow"
      popovertarget=${PANEL_ID}
      aria-controls=${PANEL_ID}
      title="Show ${hiddenCount} More ${this.menuHeading}"
      aria-label="Show ${hiddenCount} More ${this.menuHeading}"
    >
      <span class="overflow__count">+${hiddenCount}</span>
      <vscode-icon
        name=${this.icon}
        class="overflow__chevron ${this.icon === 'chevron-down' ? 'overflow__chevron--rotate' : ''}"
        size="14"
      ></vscode-icon>
    </button>`;
    // Toggle pins to the collapse end, with the divider always adjacent to the items.
    const toggle =
      hiddenCount > 0 ? (fromStart ? html`${button}${sep}` : html`${sep}${button}`) : '';

    return html`<div class="container ${this.collapseFrom}">
      <div class="bar ${this.hasEnd ? 'has-end' : ''}">
        ${fromStart ? toggle : ''}
        <div class="items" style="gap: ${this.gap}px"><slot></slot></div>
        ${fromStart ? '' : toggle}
        <slot name="end" @slotchange=${this._onEndChange}></slot>
      </div>
      ${
        hiddenCount > 0
          ? html`<div
              part="menu"
              class="panel filter-popover popover-anchored"
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
