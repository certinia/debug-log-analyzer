/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import '#vscode-elements/vscode-badge.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

export interface PaneSection {
  id: string;
  title: string;
  content: TemplateResult;
  /** Optional count/label shown as a badge in the section header. */
  badge?: string;
  /** Default flex-grow weight when open, seeded on first render (default 1). */
  weight?: number;
  /**
   * How the open pane takes space (default `'fill'`). A `'content'` pane sizes
   * to its content and shrinks — scrolling inside — when space runs out, it
   * never stretches to soak up leftovers, and it leaves the open fill panes a
   * share of the space. Dragging its sash pins it to a size instead, which a
   * double-click hands back to the content.
   * A `'fill'` pane shares the remaining space by weight.
   */
  fit?: 'content' | 'fill';
}

export type PaneOrientation = 'vertical' | 'horizontal';

const MIN_PANE_PX = 44;

/**
 * A VS Code sidebar-style PaneView: a stack of titled sections that (when
 * vertical) collapse via a twistie and share the available space, with a
 * draggable sash between adjacent open sections that redistributes their size.
 * Horizontal mode lays the sections side by side with resize-only sashes.
 */
@customElement('pane-view')
export class PaneView extends LitElement {
  @property({ attribute: false })
  sections: PaneSection[] = [];

  @property({ type: String })
  orientation: PaneOrientation = 'vertical';

  /** Collapsed sections, keyed by section id. Controlled by the consumer. */
  @property({ attribute: false })
  collapsed: Record<string, boolean> = {};

  /**
   * Pane sizes from the last drag (px), keyed `<orientation>:<section id>`.
   * Relative only, and per axis — a width dragged in the horizontal dock says
   * nothing about heights in the vertical one, so each orientation keeps its own
   * sizes and the other's are left untouched.
   */
  @property({ attribute: false })
  paneSizes: Record<string, number> = {};

  // The current axis' weights, keyed by section id: seeded from `paneSizes`,
  // then edited in place by a live drag until `pane-resize` hands the result
  // back to the consumer.
  @state()
  private _weights: Record<string, number> = {};

  private _sash: {
    aId: string;
    bId: string;
    start: number;
    startA: number;
    startB: number;
    moved: boolean;
  } | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }

      .pane-view {
        display: flex;
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }
      .pane-view[data-orientation='vertical'] {
        flex-direction: column;
        /* Every open section keeps a readable height, so when they do not all fit
           the stack scrolls rather than crowding one down to its header. */
        overflow-y: auto;
      }
      .pane-view[data-orientation='vertical'] .pane[data-open] {
        min-height: var(--lana-pane-min);
      }
      .pane-view[data-orientation='horizontal'] {
        flex-direction: row;
      }

      .pane {
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
      }
      .pane-view[data-orientation='horizontal'] .pane {
        border-right: var(--lana-stroke) solid var(--lana-panel-divider);
      }
      .pane-view[data-orientation='horizontal'] .pane:last-of-type {
        border-right: none;
      }

      .pane-header {
        display: flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        flex: 0 0 var(--lana-panel-header-height);
        height: var(--lana-panel-header-height);
        padding: 0 var(--lana-space-md) 0 var(--lana-space-2xs);
        font-size: var(--lana-text-caps);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: var(--lana-text-caps-tracking);
        color: var(--vscode-sideBarSectionHeader-foreground);
        background-color: var(--vscode-sideBarSectionHeader-background);
        border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
        user-select: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pane-header--button {
        cursor: pointer;
      }
      .pane-header--button:hover {
        background-color: var(--lana-row-hover-bg);
      }
      .pane-header:focus-visible {
        outline: 1px solid var(--lana-focus-border);
        outline-offset: -1px;
      }
      .pane-header vscode-icon {
        color: var(--lana-icon-fg);
        flex: 0 0 auto;
      }
      .pane-header__title {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pane-header vscode-badge {
        flex: 0 0 auto;
      }

      /* The body owns the panel's content edge and its base text size, so every
         section reads at one scale and only steps away from it deliberately. */
      .pane-body {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        overflow: auto;
        padding: var(--lana-space-2xs) var(--lana-space-md) var(--lana-space-sm);
        font-size: var(--lana-text-base);
      }

      .pane-sash {
        flex: 0 0 var(--lana-sash-size);
        z-index: 1;
        background-color: transparent;
        transition: background-color 0.1s ease;
      }
      .pane-view[data-orientation='vertical'] .pane-sash {
        cursor: row-resize;
        margin: var(--lana-sash-inset) 0;
      }
      .pane-view[data-orientation='horizontal'] .pane-sash {
        cursor: col-resize;
        margin: 0 var(--lana-sash-inset);
      }
      .pane-sash:hover,
      .pane-sash.pane-sash--active {
        background-color: var(--vscode-sash-hoverBorder);
      }

      @media (prefers-reduced-motion: reduce) {
        .pane-sash {
          transition: none;
        }
      }
    `,
  ];

  willUpdate(changed: PropertyValues): void {
    // Adopt whatever the consumer stored for this axis; a drag then edits this
    // copy. Re-docking flips the orientation on the same element, so that has to
    // re-seed too or the previous axis' sizes would carry over.
    if (changed.has('paneSizes') || changed.has('orientation')) {
      const prefix = `${this.orientation}:`;
      this._weights = Object.fromEntries(
        Object.entries(this.paneSizes)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, size]) => [key.slice(prefix.length), size]),
      );
    }
  }

  render() {
    const weights = this._flexWeights();
    const basis = this._fillBasis();
    const items: TemplateResult[] = [];
    this.sections.forEach((section, index) => {
      items.push(this._renderPane(section, weights.get(section.id) ?? 1, basis));
      const next = this.sections[index + 1];
      // A sash trades space between the two panes beside it, so it exists
      // wherever both neighbours are open. A content pane starts at its
      // content's size and then holds the size it is dragged to.
      if (next && this._isOpen(section.id) && this._isOpen(next.id)) {
        items.push(this._renderSash(section.id, next.id));
      }
    });

    return html`<div class="pane-view" data-orientation=${this.orientation}>${items}</div>`;
  }

  /**
   * Flex weights for the open panes, all on one scale. Stored sizes are pixel
   * snapshots taken during a drag while `section.weight` is a small unit share,
   * so the stored set is rescaled onto the unit scale: mixing the two would
   * render a section with no stored size — one added after the drag, or
   * collapsed during it — as a sliver beside its pixel-sized siblings.
   */
  private _flexWeights(): Map<string, number> {
    const open = this.sections.filter(
      (section) => this._isOpen(section.id) && this._isFill(section),
    );
    let storedPx = 0;
    let storedUnits = 0;
    for (const section of open) {
      const stored = this._weights[section.id];
      if (stored !== undefined) {
        storedPx += stored;
        storedUnits += section.weight ?? 1;
      }
    }
    // px → units, and 0 when nothing is stored so every pane falls back to units.
    const scale = storedPx > 0 ? storedUnits / storedPx : 0;
    return new Map(
      open.map((section) => {
        const stored = this._weights[section.id];
        const weight = stored !== undefined && scale > 0 ? stored * scale : (section.weight ?? 1);
        return [section.id, weight];
      }),
    );
  }

  /**
   * A fill pane's flex basis: an equal share of the panel, so a stack of
   * sized-to-content panes cannot squeeze it to `--lana-pane-min`. From a basis
   * of zero it can only grow into free space, and once the content panes fill
   * the panel there is none; from a share it shrinks alongside them instead, and
   * keeps its natural size while the panel is roomy. Zero while every open pane
   * fills, where a share each would take the whole panel and flatten the
   * weights.
   */
  private _fillBasis(): string {
    const open = this.sections.filter((section) => this._isOpen(section.id));
    const content = open.filter((section) => !this._isFill(section)).length;
    return this.orientation === 'vertical' && content > 0 ? `calc(100% / ${open.length})` : '0';
  }

  private _renderPane(section: PaneSection, weight: number, basis: string) {
    const open = this._isOpen(section.id);
    const collapsible = this._collapsible;
    // An open content pane sizes to its content, or to the size it was dragged
    // to, but stays shrinkable, so when space runs out it scrolls instead of
    // pushing the fill panes off screen.
    const dragged = this._weights[section.id];
    const style = !open
      ? 'flex: 0 0 auto'
      : this._isFill(section)
        ? `flex: ${weight} 1 ${basis}`
        : dragged !== undefined
          ? `flex: 0 1 ${dragged}px`
          : 'flex: 0 1 auto';

    return html`<div class="pane" data-id=${section.id} ?data-open=${open} style=${style}>
      <div
        class="pane-header ${collapsible ? 'pane-header--button' : ''}"
        role=${collapsible ? 'button' : nothing}
        tabindex=${collapsible ? 0 : nothing}
        aria-expanded=${collapsible ? String(open) : nothing}
        @click=${collapsible ? () => this._toggle(section.id) : undefined}
        @keydown=${collapsible ? (e: KeyboardEvent) => this._onHeaderKey(e, section.id) : undefined}
      >
        ${
          collapsible
            ? html`<vscode-icon name=${open ? 'chevron-down' : 'chevron-right'}></vscode-icon>`
            : nothing
        }
        <span class="pane-header__title">${section.title}</span>
        ${section.badge ? html`<vscode-badge>${section.badge}</vscode-badge>` : nothing}
      </div>
      ${open ? html`<div class="pane-body">${section.content}</div>` : nothing}
    </div>`;
  }

  private _renderSash(aId: string, bId: string) {
    return html`<div
      class="pane-sash"
      @pointerdown=${(e: PointerEvent) => this._startSash(e, aId, bId)}
      @dblclick=${() => this._resetSash(aId, bId)}
    ></div>`;
  }

  private get _collapsible() {
    return this.orientation === 'vertical';
  }

  private _isOpen(id: string) {
    return this._collapsible ? !this.collapsed[id] : true;
  }

  private _isFill(section: PaneSection) {
    return (section.fit ?? 'fill') === 'fill';
  }

  private _toggle(id: string) {
    // New collapsed state = the current open state (open → collapse, and vice
    // versa). The consumer owns the record, so it re-renders us with the new one.
    this.dispatchEvent(
      new CustomEvent('pane-toggle', {
        detail: { collapsed: { ...this.collapsed, [id]: this._isOpen(id) } },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onHeaderKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._toggle(id);
    }
  }

  private _paneSize(id: string): number {
    const el = this.renderRoot?.querySelector(`.pane[data-id="${id}"]`) as HTMLElement | null;
    if (!el) {
      return 0;
    }
    return this.orientation === 'vertical' ? el.offsetHeight : el.offsetWidth;
  }

  private _startSash(e: PointerEvent, aId: string, bId: string) {
    e.preventDefault();
    const sash = e.currentTarget as HTMLElement;
    sash.setPointerCapture(e.pointerId);
    sash.classList.add('pane-sash--active');

    // Snapshot every open pane's rendered size as its weight, so weights are in
    // pixels and only the two dragged panes change (their sum stays constant).
    for (const section of this.sections) {
      if (this._isOpen(section.id)) {
        this._weights[section.id] = this._paneSize(section.id);
      }
    }

    this._sash = {
      aId,
      bId,
      start: this.orientation === 'vertical' ? e.clientY : e.clientX,
      startA: this._weights[aId] ?? 0,
      startB: this._weights[bId] ?? 0,
      moved: false,
    };
    sash.addEventListener('pointermove', this._onSashMove);
    sash.addEventListener('pointerup', this._endSash);
    sash.addEventListener('pointercancel', this._cancelSash);
    sash.addEventListener('lostpointercapture', this._onLostCapture);
  }

  private _onSashMove = (e: PointerEvent) => {
    const sash = this._sash;
    if (!sash) {
      return;
    }
    const pos = this.orientation === 'vertical' ? e.clientY : e.clientX;
    const total = sash.startA + sash.startB;
    const delta = pos - sash.start;
    const newA = Math.max(MIN_PANE_PX, Math.min(sash.startA + delta, total - MIN_PANE_PX));
    sash.moved = true;
    this._weights = { ...this._weights, [sash.aId]: newA, [sash.bId]: total - newA };
  };

  private _endSash = (e: PointerEvent) => {
    const moved = this._sash?.moved ?? false;
    // A click that never moved changed no size, so it isn't worth persisting —
    // and a double-click reset would otherwise emit three times.
    if (this._teardownSash(e.currentTarget as HTMLElement, e.pointerId) && moved) {
      this._emitResize();
    }
  };

  /** An interrupted gesture (OS gesture, touch cancel) undoes the drag. */
  private _cancelSash = (e: PointerEvent) => {
    const sash = this._sash;
    if (sash) {
      this._weights = { ...this._weights, [sash.aId]: sash.startA, [sash.bId]: sash.startB };
    }
    this._teardownSash(e.currentTarget as HTMLElement, e.pointerId);
  };

  // Capture lost without a pointerup (window blur, another element capturing):
  // stop tracking, or a later move would resize with no button held.
  private _onLostCapture = (e: PointerEvent) => {
    this._teardownSash(e.currentTarget as HTMLElement, e.pointerId);
  };

  /** Detaches the drag; false if it had already ended. */
  private _teardownSash(sashEl: HTMLElement, pointerId: number): boolean {
    if (!this._sash) {
      return false;
    }
    this._sash = null;
    if (sashEl.hasPointerCapture(pointerId)) {
      sashEl.releasePointerCapture(pointerId);
    }
    sashEl.classList.remove('pane-sash--active');
    sashEl.removeEventListener('pointermove', this._onSashMove);
    sashEl.removeEventListener('pointerup', this._endSash);
    sashEl.removeEventListener('pointercancel', this._cancelSash);
    sashEl.removeEventListener('lostpointercapture', this._onLostCapture);
    return true;
  }

  /**
   * Back to each pane's default: a content pane returns to its content's size,
   * and a pair of fill panes splits the space between them evenly.
   */
  private _resetSash(aId: string, bId: string) {
    const weights = { ...this._weights };
    const dragged = [aId, bId].filter((id) => this._isContent(id));
    if (dragged.length) {
      for (const id of dragged) {
        delete weights[id];
      }
    } else {
      const total = (weights[aId] ?? this._paneSize(aId)) + (weights[bId] ?? this._paneSize(bId));
      weights[aId] = total / 2;
      weights[bId] = total / 2;
    }
    this._weights = weights;
    this._emitResize();
  }

  private _isContent(id: string): boolean {
    const section = this.sections.find((candidate) => candidate.id === id);
    return !!section && !this._isFill(section);
  }

  /** Fires on interaction-end only, so the consumer's write isn't per-frame. */
  private _emitResize() {
    // Every size this axis holds, named by it, so the consumer can replace the
    // axis: a pane reset to its content's size has no entry left to merge.
    const sizes = Object.fromEntries(
      Object.entries(this._weights).map(([id, size]) => [`${this.orientation}:${id}`, size]),
    );
    this.dispatchEvent(
      new CustomEvent('pane-resize', {
        detail: { sizes, orientation: this.orientation },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
