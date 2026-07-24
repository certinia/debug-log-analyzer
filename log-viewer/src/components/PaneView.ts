/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import '#vscode-elements/vscode-badge.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { panelTokens } from './panelTokens.js';

export interface PaneSection {
  id: string;
  title: string;
  content: TemplateResult;
  /** Optional count/label shown as a badge in the section header. */
  badge?: string;
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

  // Transient per-session state.
  @state()
  private _collapsed: Record<string, boolean> = {};
  @state()
  private _weights: Record<string, number> = {};

  private _sash: {
    aId: string;
    bId: string;
    start: number;
    startA: number;
    startB: number;
  } | null = null;

  static styles = [
    globalStyles,
    panelTokens,
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
        border-right: 1px solid var(--vscode-sideBar-border, transparent);
      }
      .pane-view[data-orientation='horizontal'] .pane:last-of-type {
        border-right: none;
      }

      .pane-header {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        flex: 0 0 var(--panel-header-height);
        height: var(--panel-header-height);
        padding: 0 var(--space-3) 0 var(--space-1);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
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
        background-color: var(--vscode-list-hoverBackground);
      }
      .pane-header:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }
      .pane-header vscode-icon {
        color: var(--vscode-icon-foreground);
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

      .pane-body {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        overflow: auto;
        padding: var(--space-1) var(--space-3) var(--space-2);
      }

      .pane-sash {
        flex: 0 0 4px;
        z-index: 1;
        background-color: transparent;
        transition: background-color 0.1s ease;
      }
      .pane-view[data-orientation='vertical'] .pane-sash {
        cursor: row-resize;
        margin: -2px 0;
      }
      .pane-view[data-orientation='horizontal'] .pane-sash {
        cursor: col-resize;
        margin: 0 -2px;
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

  render() {
    const items: TemplateResult[] = [];
    this.sections.forEach((section, index) => {
      items.push(this._renderPane(section));
      const next = this.sections[index + 1];
      if (next && this._isOpen(section.id) && this._isOpen(next.id)) {
        items.push(this._renderSash(section.id, next.id));
      }
    });

    return html`<div class="pane-view" data-orientation=${this.orientation}>${items}</div>`;
  }

  private _renderPane(section: PaneSection) {
    const open = this._isOpen(section.id);
    const collapsible = this._collapsible;
    const style = open ? `flex: ${this._weights[section.id] ?? 1} 1 0` : 'flex: 0 0 auto';

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
    return this._collapsible ? !this._collapsed[id] : true;
  }

  private _toggle(id: string) {
    this._collapsed = { ...this._collapsed, [id]: !this._collapsed[id] };
    this.requestUpdate();
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
    };
    sash.addEventListener('pointermove', this._onSashMove);
    sash.addEventListener('pointerup', this._endSash);
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
    this._weights = { ...this._weights, [sash.aId]: newA, [sash.bId]: total - newA };
    this.requestUpdate();
  };

  private _endSash = (e: PointerEvent) => {
    const sashEl = e.currentTarget as HTMLElement;
    sashEl.releasePointerCapture(e.pointerId);
    sashEl.classList.remove('pane-sash--active');
    sashEl.removeEventListener('pointermove', this._onSashMove);
    sashEl.removeEventListener('pointerup', this._endSash);
    this._sash = null;
  };

  private _resetSash(aId: string, bId: string) {
    const total =
      (this._weights[aId] ?? this._paneSize(aId)) + (this._weights[bId] ?? this._paneSize(bId));
    this._weights = { ...this._weights, [aId]: total / 2, [bId]: total / 2 };
    this.requestUpdate();
  }
}
