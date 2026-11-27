/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';

import { ResizeController } from '../core/events/ResizeController.js';
import type { AnchoredPopover } from './AnchoredPopover.js';
import { OVERFLOW_RESERVE } from './OverflowList.js';
import { computeVisibleCount } from './overflowFit.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { HEADER_CONTROL_WIDTH, headerControlStyles } from '../styles/headerControl.styles.js';

// components
import './AnchoredPopover.js';
import './Divider.js';

/** The sections in keep order: actions go into `•••` first; global never does, it compacts. */
const SECTIONS = ['global', 'table-actions', 'group', 'actions'] as const;
type Section = (typeof SECTIONS)[number];

/** Gap between sections and between the two clusters (px). */
const BAR_GAP = 8;
/** Gap + divider + gap that each inline section adds beside its own box (px). */
const SECTION_OVERHEAD = 2 * BAR_GAP + 1;
/** The `.header-control` toggle plus the gap before it (px). */
const MORE_RESERVE = HEADER_CONTROL_WIDTH + BAR_GAP;

/**
 * Shared grid toolbar. Content is grouped into sections, left→right:
 *   global · table-actions · filters   (left cluster)
 *   group · actions                    (right cluster, right-aligned)
 * A vertical divider is drawn between adjacent non-empty sections; the flexible
 * gap separates the left cluster from the right-aligned grouping/actions.
 *
 * When narrow, the filters collapse first (their own `<overflow-list>`). Past that,
 * whole sections move into a trailing `•••` menu: actions, group, then table-actions.
 * Like `<overflow-list>`, a collapsed section's children are re-slotted to
 * `slot="overflow"`, not copied, so a child's `slot` must be static, never bound.
 *
 * The global section holds the tab's state, so it stays on the bar: once it no longer
 * fits at full width, its children get a `compact` attribute and render smaller.
 */
@customElement('datagrid-filter-bar')
export class DatagridFilterBar extends LitElement {
  static styles = [
    globalStyles,
    headerControlStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
        /* The grid below is positioned, so it would paint over a focus ring that reaches past the bar. */
        position: relative;
        z-index: 1;
      }

      .filter-bar {
        display: flex;
        align-items: flex-end;
        gap: ${unsafeCSS(BAR_GAP)}px;
        width: 100%;
      }

      .filter-bar__left,
      .filter-bar__right {
        display: flex;
        align-items: flex-end;
        gap: ${unsafeCSS(BAR_GAP)}px;
        /* Allow the clusters to shrink below content width so a section's
           overflow-list receives a constrained width and can collapse. */
        min-width: 0;
      }

      /* Left cluster consumes the slack (via its growable filters section) so a
         collapsed overflow-list regains width and can re-expand on widen; the
         right cluster then sits at the far edge with no growth. */
      .filter-bar__left {
        flex: 1 1 auto;
      }

      .filter-bar__right {
        flex: 0 0 auto;
      }

      .section {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        /* Only the filters section shrinks: its overflow-list collapses before any control truncates. */
        flex-shrink: 0;
      }

      /* Filters section takes the left cluster's slack and passes it to its
         slotted overflow-list, so the list always knows the full width
         available and can re-expand collapsed items when the bar widens. */
      .section--grow {
        flex: 1 1 auto;
        /* Lets the section hand its overflow-list a bounded width (min-width:auto would keep it at content size). */
        min-width: 0;
      }

      /* With a section in the menu, the filters keep only their toggle: width it frees
         must not bring filters back, or narrowing would show more, not less. */
      .section--grow.section--held {
        flex: 0 0 ${unsafeCSS(OVERFLOW_RESERVE)}px;
      }

      .section--grow ::slotted([slot='filters']) {
        flex: 1 1 auto;
        min-width: 0;
      }

      .section[hidden],
      anchored-popover[hidden] {
        display: none;
      }

      /* Fits the widest collapsed control, such as the whole view-mode switch. */
      anchored-popover {
        --anchored-popover-width: max-content;
      }

      divider-line {
        align-self: stretch;
        margin: var(--lana-space-3xs) 0;
      }
    `,
  ];

  /** How many leading `SECTIONS` stay inline; the rest are in the `•••` menu. */
  @state() private _visibleCount: number = SECTIONS.length;

  /** The global section is too wide for the bar, so its children render compact. */
  @state() private _compact = false;

  /** Width per section, measured while inline; a collapsed section has no box to measure. */
  private _widths = new Map<Section, number>();
  private _hostWidth = 0;

  @query('anchored-popover')
  private _menu?: AnchoredPopover;

  // Also fed by each section's box: a picker's new value or a font load can widen one
  // with no host resize.
  private readonly _resize = new ResizeController(this, (entries) => {
    const host = entries.find((entry) => entry.target === this);
    if (host) {
      // Zero while the tab is hidden, which leaves the layout as it is until it shows.
      this._hostWidth = host.contentRect.width;
    }
    this._fit();
  });

  protected override firstUpdated(): void {
    for (const section of this.renderRoot.querySelectorAll('.section:not(.section--grow)')) {
      this._resize.observe(section);
    }
  }

  /** Slot content arriving or leaving can change a section's width; the fit's own result cannot. */
  protected override updated(changed: PropertyValues<this>): void {
    if ([...changed.keys()].some((key) => key !== '_visibleCount' && key !== '_compact')) {
      this._fit();
    }
  }

  private _slotFor(name: string): HTMLSlotElement | null {
    return this.renderRoot.querySelector<HTMLSlotElement>(`slot[name="${name}"]`);
  }

  private _collapsedIn(section: Section): NodeListOf<Element> {
    return this.querySelectorAll(`:scope > [slot='overflow'][data-home='${section}']`);
  }

  private _fit(): void {
    if (!this._hostWidth) {
      return;
    }
    const widths = SECTIONS.map((section, i) => {
      const slot = this._slotFor(section);
      const inline = i < this._visibleCount && !!slot?.assignedElements().length;
      // A compact global section keeps its full width cached: that is what it needs to expand.
      const box = inline && !(section === 'global' && this._compact) ? slot?.parentElement : null;
      if (box?.offsetWidth) {
        this._widths.set(section, box.offsetWidth + SECTION_OVERHEAD);
      } else if (!inline && !this._collapsedIn(section).length) {
        this._widths.delete(section);
      }
      return this._widths.get(section) ?? 0;
    });
    // Nothing laid out yet (jsdom, or first paint) — leave the layout be.
    if (widths.every((width) => width === 0)) {
      return;
    }
    // The filters keep room for their own toggle and the divider before it.
    const filters = this._hasFilters ? OVERFLOW_RESERVE + SECTION_OVERHEAD : 0;
    const fit = computeVisibleCount(widths, this._hostWidth - filters, 0, MORE_RESERVE);
    this._compact = fit === 0;
    this._visibleCount = Math.max(fit, 1);
    if (this._visibleCount === SECTIONS.length) {
      // Hidden with its toggle, an open panel would come back open on the next collapse.
      this._menu?.close();
    }
    this._applyCollapse();
  }

  /** Move each collapsed section's children into the menu, and the others back home. */
  private _applyCollapse(): void {
    for (const el of this._slotFor('global')?.assignedElements() ?? []) {
      el.toggleAttribute('compact', this._compact);
    }
    SECTIONS.forEach((section, i) => {
      if (i >= this._visibleCount) {
        for (const el of this._slotFor(section)?.assignedElements() ?? []) {
          el.setAttribute('data-home', section);
          // An attribute, not `el.slot`: `vs-select` and the filters shadow `slot` with a property.
          // `overflow`, as in `<overflow-list>`, so the controls take their menu layout.
          el.setAttribute('slot', 'overflow');
        }
      } else {
        for (const el of this._collapsedIn(section)) {
          el.setAttribute('slot', section);
          el.removeAttribute('data-home');
        }
      }
    });
  }

  /** A command run from the menu closes it, as in `HeaderMenu`; a picker stays open for its list. */
  private _onMenuClick(event: Event): void {
    const command = event
      .composedPath()
      .some((node) => node instanceof HTMLElement && node.classList.contains('menu-row'));
    if (command) {
      this._menu?.close();
    }
  }

  @state() private _hasGlobal = false;
  @state() private _hasTableActions = false;
  @state() private _hasFilters = false;
  @state() private _hasGroup = false;
  @state() private _hasActions = false;

  private _slotChange(
    prop: '_hasGlobal' | '_hasTableActions' | '_hasFilters' | '_hasGroup' | '_hasActions',
  ) {
    return (event: Event) => {
      this[prop] = (event.target as HTMLSlotElement).assignedElements().length > 0;
      if (prop === '_hasGlobal') {
        // Compact, the section cannot show its full width, so the cached one may be stale.
        this._widths.delete('global');
        this._fit();
      }
    };
  }

  private _divider() {
    return html`<divider-line orientation="vertical"></divider-line>`;
  }

  render() {
    // Dividers sit between adjacent non-empty sections within each cluster.
    const tableActionsDivider = this._hasGlobal && this._hasTableActions;
    const filtersDivider = this._hasFilters && (this._hasGlobal || this._hasTableActions);
    const actionsDivider = this._hasGroup && this._hasActions;

    // Empty sections are hidden so they don't add stray gaps.
    return html`<div class="filter-bar">
      <div class="filter-bar__left">
        <div class="section" ?hidden=${!this._hasGlobal}>
          <slot name="global" @slotchange=${this._slotChange('_hasGlobal')}></slot>
        </div>
        ${tableActionsDivider ? this._divider() : nothing}
        <div class="section" ?hidden=${!this._hasTableActions}>
          <slot name="table-actions" @slotchange=${this._slotChange('_hasTableActions')}></slot>
        </div>
        ${filtersDivider ? this._divider() : nothing}
        <div
          class="section section--grow ${this._visibleCount < SECTIONS.length ? 'section--held' : ''}"
          ?hidden=${!this._hasFilters}
        >
          <slot name="filters" @slotchange=${this._slotChange('_hasFilters')}></slot>
        </div>
      </div>

      <div class="filter-bar__right">
        <div class="section" ?hidden=${!this._hasGroup}>
          <slot name="group" @slotchange=${this._slotChange('_hasGroup')}></slot>
        </div>
        ${actionsDivider ? this._divider() : nothing}
        <div class="section" ?hidden=${!this._hasActions}>
          <slot name="actions" @slotchange=${this._slotChange('_hasActions')}></slot>
        </div>
        <anchored-popover
          align="end"
          heading="More"
          ?hidden=${this._visibleCount === SECTIONS.length}
        >
          <span slot="trigger" class="header-control" title="More" aria-label="More">
            <vscode-icon name="ellipsis" size="16"></vscode-icon>
          </span>
          <div slot="panel" class="menu-items" @click=${this._onMenuClick}>
            <slot name="overflow"></slot>
          </div>
        </anchored-popover>
      </div>
    </div>`;
  }
}
