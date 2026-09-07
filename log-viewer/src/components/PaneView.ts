/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import '#vscode-elements/vscode-badge.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

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
   * How the open pane takes space (default `'fill'`). A `'content'` pane asks
   * for its content and never for more, so it does not stretch to soak up
   * leftovers — but it asks for no more than an equal share of the panel
   * either, growing back towards its content only as far as the room the other
   * sections leave and scrolling inside beyond that. So no one section can take
   * the panel and hold every other one at its floor. Dragging its sash gives it
   * whatever room the drag asks for; a double-click hands it back.
   * A `'fill'` pane shares the remaining space by weight.
   *
   * Only for content that does not change with what the consumer is showing.
   * A section that says something different about each selection sizes itself
   * with {@link PaneSection.height} instead: sizing that content would move
   * every boundary in the stack each time the reader steps to the next one.
   */
  fit?: 'content' | 'fill';
  /**
   * A steady height, in place of the pane's content or its share: the choice for
   * a section whose content changes with the selection. The tier names a
   * `--lana-pane-*` token, so the height lives in CSS — a share of the panel
   * between two bounds, which scales with the room there is and depends on
   * nothing the selection changes. A dragged size still wins, and the section
   * scrolls inside when it has more to show.
   *
   * Read while the stack is vertical, the only axis on which a section has a
   * height; laid out side by side it shares the width like any fill pane.
   */
  height?: 'sm' | 'md';
}

export type PaneOrientation = 'vertical' | 'horizontal';

/** An open pane as a sash drag found it: what it measured, and its floor. */
interface SashPane {
  id: string;
  size: number;
  min: number;
}

/**
 * A VS Code sidebar-style PaneView: a stack of titled sections that (when
 * vertical) collapse via a twistie and share the available space, with a
 * draggable sash between adjacent open sections. Dragging one gives room to the
 * sections on one side of it and takes it from the other, nearest first: each
 * gives up room down to `--lana-pane-min` and then the next one does, so the
 * sash keeps following the pointer until the whole giving side is at its floor.
 * Horizontal mode lays the sections side by side with resize-only sashes.
 *
 * Dragging a header — or `Alt+Arrow` on a focused one — reorders the stack. The
 * consumer owns the order, and hears the new one through `pane-reorder`.
 * Right-clicking a header reports `pane-menu`: the consumer knows what sections
 * there are, so it owns the menu.
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

  /** Bump to drop the sizes the panes were dragged to, back to automatic. */
  @property({ type: Number })
  layoutEpoch = 0;

  // Sizes a drag has given the panes it named (px), keyed by section id. The
  // panel keeps them while it is open and never persists them: sections size
  // themselves from their content and the space there is, and a layout dragged
  // for one log is the wrong one for the next.
  @state()
  private _weights: Record<string, number> = {};

  // The header being dragged, and where it would land: an insertion point in
  // `sections`, so one boundary is one mark however it was reached.
  @state()
  private _dragId: string | null = null;
  @state()
  private _dropIndex: number | null = null;

  // The header to put focus back on once a keyboard move has re-rendered.
  private _focusId: string | null = null;

  private _sash: {
    /** The panes each way from the sash, nearest it first, and the room each side has. */
    above: SashPane[];
    below: SashPane[];
    slackAbove: number;
    slackBelow: number;
    /** Every open pane at the size it was measured at, keyed by id. */
    measured: Record<string, number>;
    start: number;
    /** The last delta applied, so a move that changes nothing renders nothing. */
    delta?: number;
    /** The dragged sizes as the gesture found them, so a cancel puts them back. */
    weights: Record<string, number>;
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
      .pane-view[data-orientation='horizontal'] .pane[data-open] {
        min-width: var(--lana-pane-min);
      }

      /* How a section takes space, in one place. The element carries only the
         numbers behind it: --pane-grow for a fill pane's weight, --pane-count
         for the share, and --pane-size for a size the reader dragged to.

         A drag beats every default here, and one mechanism says so: --pane-size
         is set only on a dragged pane, so every rule below reads it first and
         falls back to what it would otherwise have used. */
      .pane {
        flex: 0 0 auto;
      }
      /* Open: it shrinks — scrolling inside — when the space runs out. Each
         sizing mode below sets its own basis. */
      .pane[data-open] {
        flex-shrink: 1;
      }
      .pane[data-open][data-sizing='fill'] {
        flex-grow: var(--pane-grow, 1);
        flex-basis: var(--pane-size, 0);
      }
      /* An equal share as the basis, so the panes shrink alongside each other
         rather than by size. From a basis of zero a fill pane can only grow
         into free space, and a stack of sized-to-content panes leaves none — it
         would sit at the floor; a content pane sized to its content is the one
         holding it there, because flexbox shrinks by basis and the biggest
         keeps the most. A tier is exempt: a bounded slot already, and a share
         here would over-subscribe the panel and flatten the weights. */
      .pane-view[data-content] .pane[data-open][data-sizing='fill'],
      .pane[data-open][data-sizing='content'] {
        flex-basis: var(--pane-size, calc(100% / var(--pane-count)));
      }
      /* A content pane is then a weight-1 fill pane capped at its content: it
         never stretches past what it has to show, and scrolls when the share is
         all it gets. */
      .pane[data-open][data-sizing='content'] {
        flex-grow: 1;
      }
      .pane-view[data-orientation='vertical'] .pane[data-open][data-sizing='content'] {
        max-height: var(--pane-size, max-content);
      }
      .pane-view[data-orientation='horizontal'] .pane[data-open][data-sizing='content'] {
        max-width: var(--pane-size, max-content);
      }

      /* A steady height, so walking the selection does not resize the stack.
         Only a vertical stack is given a tier, so no rule here re-checks it. */
      .pane[data-open][data-tier='sm'] {
        flex-basis: var(--pane-size, var(--lana-pane-sm));
      }
      .pane[data-open][data-tier='md'] {
        flex-basis: var(--pane-size, var(--lana-pane-md));
      }

      .pane {
        position: relative;
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

      /* Where a dragged section would land, on the edge it would land against.
         Drawn over the content: the header paints its own background, so a
         shadow cast by the pane behind it would not show. */
      .pane--drop-before::after,
      .pane--drop-after::after {
        content: '';
        position: absolute;
        z-index: 2;
        background-color: var(--lana-focus-border);
      }
      .pane-view[data-orientation='vertical'] .pane--drop-before::after,
      .pane-view[data-orientation='vertical'] .pane--drop-after::after {
        left: 0;
        right: 0;
        height: var(--lana-space-3xs);
      }
      .pane-view[data-orientation='vertical'] .pane--drop-before::after {
        top: 0;
      }
      .pane-view[data-orientation='vertical'] .pane--drop-after::after {
        bottom: 0;
      }
      .pane-view[data-orientation='horizontal'] .pane--drop-before::after,
      .pane-view[data-orientation='horizontal'] .pane--drop-after::after {
        top: 0;
        bottom: 0;
        width: var(--lana-space-3xs);
      }
      .pane-view[data-orientation='horizontal'] .pane--drop-before::after {
        left: 0;
      }
      .pane-view[data-orientation='horizontal'] .pane--drop-after::after {
        right: 0;
      }
      .pane--dragging {
        opacity: 0.6;
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
        border-top: var(--lana-stroke) solid var(--vscode-sideBarSectionHeader-border, transparent);
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
      /* Focus, not focus-visible: the focused header is the one Alt+Arrow moves,
         so which one that is has to show even when a click put it there. */
      .pane-header:focus {
        outline: var(--lana-focus-ring);
        outline-offset: var(--lana-focus-inset);
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
    // Re-docking flips the orientation on the same element, and a height dragged
    // down the side says nothing about a width along the bottom.
    if (changed.has('orientation') || changed.has('layoutEpoch')) {
      this._weights = {};
    }
  }

  updated(): void {
    // A keyboard move re-renders the stack under the pointer of the keyboard, so
    // the moved section keeps the focus and a second press moves the same one.
    if (this._focusId) {
      this._headerFor(this._focusId)?.focus();
      this._focusId = null;
    }
  }

  render() {
    const isOpen = this.sections.map((section) => this._isOpen(section.id));
    const open = this.sections.filter((_section, index) => isOpen[index]);
    const dragged = this._draggedWeights(open);

    // Keyed on the section, so a reorder — or a collapse that adds a sash above
    // one — moves the panes that are already there. Rendered by position they
    // would be rebuilt in place instead, re-mounting each body's grid and
    // losing its scroll, its expanded rows and the row the user picked.
    return html`<div
      class="pane-view"
      data-orientation=${this.orientation}
      ?data-content=${this._needsShare(open)}
      style=${styleMap({ '--pane-count': String(open.length) })}
      @dragover=${this._onDragOver}
      @drop=${this._onDrop}
      @dragleave=${this._onStackDragLeave}
    >
      ${repeat(
        this.sections,
        (section) => section.id,
        (section, index) => {
          const next = this.sections[index + 1];
          // A sash trades space between the two panes beside it, so it exists
          // wherever both neighbours are open, and travels with the pane above.
          const sash =
            next && isOpen[index] && isOpen[index + 1]
              ? this._renderSash(section.id, next.id)
              : nothing;
          return html`${this._renderPane(
            section,
            dragged.get(section.id) ?? section.weight ?? 1,
            this._dropEdge(index),
          )}${sash}`;
        },
      )}
    </div>`;
  }

  /**
   * The dragged fill panes' weights, rescaled from pixels onto the unit scale
   * `section.weight` uses. A dragged pane takes its size from its basis, not
   * from this, so what the rescale decides is how the panes split whatever is
   * left over — after the dock is resized, or a section is collapsed. Mixing
   * the two scales would hand nearly all of it to the panes that were dragged.
   */
  private _draggedWeights(open: PaneSection[]): Map<string, number> {
    const fill = open.filter(
      (section) => this._sizingOf(section) === 'fill' && this._weights[section.id] !== undefined,
    );
    let px = 0;
    let units = 0;
    for (const section of fill) {
      px += this._weights[section.id] ?? 0;
      units += section.weight ?? 1;
    }
    if (px === 0) {
      return new Map();
    }
    const scale = units / px;
    return new Map(fill.map((section) => [section.id, (this._weights[section.id] ?? 0) * scale]));
  }

  /**
   * Whether the fill panes need a share of the panel rather than a basis of
   * zero — which the stylesheet decides from `data-content`. True while some
   * open pane is sized by its content, the one size nothing here bounds; see
   * the rule itself for what the share buys and what it costs. Only down the
   * side: laid out along the bottom the sections share the width already.
   */
  private _needsShare(open: PaneSection[]): boolean {
    return (
      this.orientation === 'vertical' &&
      open.some((section) => this._sizingOf(section) === 'content')
    );
  }

  private _renderPane(section: PaneSection, weight: number, drop: 'before' | 'after' | null) {
    const open = this._isOpen(section.id);
    const collapsible = this._collapsible;
    const sizing = this._sizingOf(section);
    const dragged = this._weights[section.id];

    return html`<div
      class=${classMap({
        pane: true,
        'pane--dragging': this._dragId === section.id,
        'pane--drop-before': drop === 'before',
        'pane--drop-after': drop === 'after',
      })}
      data-id=${section.id}
      ?data-open=${open}
      data-sizing=${sizing}
      data-tier=${sizing === 'tier' ? section.height : nothing}
      style=${styleMap({
        '--pane-grow': sizing === 'fill' ? String(weight) : null,
        '--pane-size': dragged !== undefined ? `${dragged}px` : null,
      })}
    >
      <div
        class="pane-header ${collapsible ? 'pane-header--button' : ''}"
        role=${collapsible ? 'button' : nothing}
        tabindex="0"
        aria-expanded=${collapsible ? String(open) : nothing}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        draggable="true"
        @click=${collapsible ? () => this._toggle(section.id) : undefined}
        @keydown=${(e: KeyboardEvent) => this._onHeaderKey(e, section.id)}
        @contextmenu=${(e: MouseEvent) => this._onHeaderMenu(e, section.id)}
        @dragstart=${(e: DragEvent) => this._onDragStart(e, section.id)}
        @dragend=${this._endDrag}
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

  /**
   * The edge of this pane a dragged section would land against, if any. Every
   * boundary but the last is the near edge of the pane below it, so only the
   * final position marks a pane's far edge.
   */
  private _dropEdge(index: number): 'before' | 'after' | null {
    if (this._dropIndex === index) {
      return 'before';
    }
    const last = this.sections.length - 1;
    return this._dropIndex === last + 1 && index === last ? 'after' : null;
  }

  private _renderSash(aId: string, bId: string) {
    return html`<div
      class="pane-sash"
      @pointerdown=${(e: PointerEvent) => this._startSash(e, aId)}
      @dblclick=${() => this._resetSash(aId, bId)}
    ></div>`;
  }

  private get _collapsible() {
    return this.orientation === 'vertical';
  }

  private _isOpen(id: string) {
    return this._collapsible ? !this.collapsed[id] : true;
  }

  /**
   * Which of the three ways this pane takes space. One derivation, so the modes
   * stay mutually exclusive and the stylesheet, the share and the drag all read
   * the same answer.
   */
  private _sizingOf(section: PaneSection): 'fill' | 'content' | 'tier' {
    if (section.height && this.orientation === 'vertical') {
      return 'tier';
    }
    return (section.fit ?? 'fill') === 'content' ? 'content' : 'fill';
  }

  private _paneEl(id: string): HTMLElement | null {
    return this.renderRoot?.querySelector<HTMLElement>(`.pane[data-id="${id}"]`) ?? null;
  }

  private _headerFor(id: string): HTMLElement | null {
    return this._paneEl(id)?.querySelector<HTMLElement>('.pane-header') ?? null;
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
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      // Fires once: each move is a layout the consumer persists.
      if (!e.repeat) {
        this._moveBy(id, e.key === 'ArrowUp' ? -1 : 1);
      }
      return;
    }
    if (this._collapsible && (e.key === 'Enter' || e.key === ' ')) {
      // Consumed on a repeat too, so Space never scrolls the stack.
      e.preventDefault();
      // Fires once: a repeat would flap the pane, and each toggle persists a setting.
      if (!e.repeat) {
        this._toggle(id);
      }
    }
  }

  /** The keyboard's reach for the header drag: one place per press. */
  private _moveBy(id: string, step: number) {
    const from = this.sections.findIndex((section) => section.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= this.sections.length) {
      return;
    }
    this._focusId = id;
    this._emitReorder(this._reorderedIds(from, to));
  }

  /** The consumer owns which sections there are, so it owns the menu too. */
  private _onHeaderMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent('pane-menu', {
        detail: { id, x: e.clientX, y: e.clientY },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onDragStart(e: DragEvent, id: string) {
    this._dragId = id;
    if (e.dataTransfer) {
      // The payload is the id, so a drop outside the stack carries something
      // meaningful rather than nothing.
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  private _onDragOver = (e: DragEvent) => {
    if (!this._dragId) {
      return;
    }
    // Claiming the drag is what makes the drop land here at all, and it is
    // claimed for the whole stack — headers, bodies, sashes and the section
    // being dragged — or crossing any of them reads as leaving.
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    this._dropIndex = this._insertionIndex(e);
  };

  /**
   * Where the dragged section would land: the first pane whose middle the
   * pointer has not passed, or the end of the stack. Measured against the whole
   * pane rather than its header, so the target is the section the pointer is
   * over, not a strip at the top of it.
   */
  private _insertionIndex(e: DragEvent): number | null {
    const vertical = this.orientation === 'vertical';
    const pos = vertical ? e.clientY : e.clientX;
    let index = this.sections.length;
    for (const [i, section] of this.sections.entries()) {
      const rect = this._paneEl(section.id)?.getBoundingClientRect();
      if (!rect) {
        continue;
      }
      const middle = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
      if (pos < middle) {
        index = i;
        break;
      }
    }
    const from = this.sections.findIndex((section) => section.id === this._dragId);
    // Either edge of where it already sits moves nothing, so nothing is marked.
    return index === from || index === from + 1 ? null : index;
  }

  // Leaving the stack drops the mark. Moving between headers inside it does not:
  // the next `dragover` sets the mark again, and clearing here would flicker.
  private _onStackDragLeave = (e: DragEvent) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) {
      this._dropIndex = null;
    }
  };

  private _onDrop = (e: DragEvent) => {
    e.preventDefault();
    const from = this.sections.findIndex((section) => section.id === this._dragId);
    const index = this._dropIndex;
    this._endDrag();
    if (from >= 0 && index !== null) {
      // Lifting the section out shifts every later boundary up one.
      this._emitReorder(this._reorderedIds(from, index > from ? index - 1 : index));
    }
  };

  private _endDrag = () => {
    this._dragId = null;
    this._dropIndex = null;
  };

  /** The section ids with the one at `from` lifted out and put back at `to`. */
  private _reorderedIds(from: number, to: number): string[] {
    const ids = this.sections.map((section) => section.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    return ids;
  }

  /** Fires with the whole order, so the consumer stores it rather than
   *  reconstructing the move. */
  private _emitReorder(ids: string[]) {
    this.dispatchEvent(
      new CustomEvent('pane-reorder', {
        detail: { ids },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The floor a pane cannot be dragged below, read from the pane itself so the
   * drag stops exactly where CSS would: one token sets it, every section shares
   * it, and the stack's arithmetic keeps matching what is on screen. Zero where
   * there is no layout to read (jsdom), which leaves CSS the only floor.
   */
  private _paneMin(id: string): number {
    const el = this._paneEl(id);
    if (!el) {
      return 0;
    }
    const style = getComputedStyle(el);
    return parseFloat(this.orientation === 'vertical' ? style.minHeight : style.minWidth) || 0;
  }

  private _paneSize(id: string): number {
    const el = this._paneEl(id);
    if (!el) {
      return 0;
    }
    return this.orientation === 'vertical' ? el.offsetHeight : el.offsetWidth;
  }

  /** `aId` is the pane above the sash (left of it, side by side). */
  private _startSash(e: PointerEvent, aId: string) {
    e.preventDefault();
    const sash = e.currentTarget as HTMLElement;
    sash.setPointerCapture(e.pointerId);
    sash.classList.add('pane-sash--active');

    // Snapshot the whole open stack as pixels: the drag gives the panes on one
    // side of the sash to the panes on the other, and once the nearest of them
    // is at its floor the next one gives up room in its place. Nothing is
    // written yet, so a sash click that never moves changes no size at all.
    //
    // One token sets the floor and every section shares it, so it is resolved
    // once rather than per pane.
    const ids = this.sections.filter((section) => this._isOpen(section.id)).map(({ id }) => id);
    const min = this._paneMin(ids[0] ?? '');
    const panes = ids.map((id) => ({ id, size: this._paneSize(id), min }));
    // Nearest the sash first, so that pane gives up room until it is at its
    // floor, then the one beyond it does, out to the end of the stack.
    const index = panes.findIndex((pane) => pane.id === aId);
    const above = panes.slice(0, index + 1).reverse();
    const below = panes.slice(index + 1);
    this._sash = {
      above,
      below,
      slackAbove: this._slack(above),
      slackBelow: this._slack(below),
      measured: Object.fromEntries(panes.map((pane) => [pane.id, pane.size])),
      start: this._pointerPos(e),
      weights: { ...this._weights },
    };
    sash.addEventListener('pointermove', this._onSashMove);
    sash.addEventListener('pointerup', this._endSash);
    sash.addEventListener('pointercancel', this._cancelSash);
    sash.addEventListener('lostpointercapture', this._endSash);
  }

  private _onSashMove = (e: PointerEvent) => {
    const sash = this._sash;
    if (!sash) {
      return;
    }
    // The stack's size is fixed, so the room one side takes is the room the
    // other gives up: the drag stops once the giving side is all at its floor,
    // and a move past that changes nothing worth rendering.
    const delta = Math.max(
      -sash.slackAbove,
      Math.min(this._pointerPos(e) - sash.start, sash.slackBelow),
    );
    if (delta === sash.delta) {
      return;
    }
    sash.delta = delta;

    // Every open pane holds its measured size for the length of the gesture, so
    // the bases add up to the panel and flexbox has nothing to shrink. Leave one
    // sizing itself and its basis is its content — larger than it renders at once
    // the panel is over-subscribed — so the whole stack would shrink and the
    // boundary would lag the pointer. `_settleSash` lets the untouched ones go.
    const weights = { ...sash.weights, ...sash.measured };
    this._distribute(sash.above, delta, weights);
    this._distribute(sash.below, -delta, weights);
    this._weights = weights;
  };

  /**
   * Hands every pane the drag never moved back to sizing itself. Only the ones
   * it did keep a size, so a content section elsewhere in the stack goes on
   * fitting its content and a tier goes back to its token.
   */
  private _settleSash(): void {
    const sash = this._sash;
    if (!sash) {
      return;
    }
    const weights = { ...this._weights };
    for (const pane of [...sash.above, ...sash.below]) {
      if (weights[pane.id] === pane.size && sash.weights[pane.id] === undefined) {
        delete weights[pane.id];
      }
    }
    this._weights = weights;
  }

  private _slack(side: SashPane[]): number {
    return side.reduce((room, pane) => room + pane.size - pane.min, 0);
  }

  /** Gives `room` to `side`, nearest the sash first, each pane down to its floor. */
  private _distribute(side: SashPane[], room: number, into: Record<string, number>): void {
    let left = room;
    for (const pane of side) {
      const size = Math.max(pane.min, pane.size + left);
      left -= size - pane.size;
      if (size !== pane.size) {
        into[pane.id] = size;
      }
    }
  }

  private _pointerPos(e: PointerEvent): number {
    return this.orientation === 'vertical' ? e.clientY : e.clientX;
  }

  // Also the handler for a capture lost without a pointerup (window blur,
  // another element capturing): either way the gesture is over, or a later move
  // would resize with no button held.
  private _endSash = (e: PointerEvent) => {
    this._settleSash();
    this._teardownSash(e.currentTarget as HTMLElement, e.pointerId);
  };

  /** An interrupted gesture (OS gesture, touch cancel) undoes the drag. */
  private _cancelSash = (e: PointerEvent) => {
    if (this._sash) {
      this._weights = this._sash.weights;
    }
    this._teardownSash(e.currentTarget as HTMLElement, e.pointerId);
  };

  /** Detaches the drag, unless it had already ended. */
  private _teardownSash(sashEl: HTMLElement, pointerId: number): void {
    if (!this._sash) {
      return;
    }
    this._sash = null;
    if (sashEl.hasPointerCapture(pointerId)) {
      sashEl.releasePointerCapture(pointerId);
    }
    sashEl.classList.remove('pane-sash--active');
    sashEl.removeEventListener('pointermove', this._onSashMove);
    sashEl.removeEventListener('pointerup', this._endSash);
    sashEl.removeEventListener('pointercancel', this._cancelSash);
    sashEl.removeEventListener('lostpointercapture', this._endSash);
  }

  /**
   * Back to each pane's default: a content pane returns to its content's size,
   * and a pair of fill panes splits the space between them evenly. Only the two
   * beside the sash — a drag that cascaded past them leaves those at the sizes
   * it gave them, and `layoutEpoch` is what hands the whole stack back.
   */
  private _resetSash(aId: string, bId: string) {
    const weights = { ...this._weights };
    const dragged = [aId, bId].filter((id) => {
      const section = this.sections.find((candidate) => candidate.id === id);
      return !!section && this._sizingOf(section) !== 'fill';
    });
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
  }
}
