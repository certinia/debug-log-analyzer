/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';
import './DetailDock.js';
import type { DockPosition } from './DetailDock.js';
import type { PaneSection } from './PaneView.js';

const MIN_SIZE = 120;
// Room for a fully collapsed toolbar, so the main pane never overlaps itself.
const MAIN_MIN_SIZE = 240;
// Drag past the minimum by this much to fully collapse the panel.
const COLLAPSE_OVERSHOOT = 60;

/**
 * Generic docked-panel layout host. Wraps a `main` slot beside/below a
 * `<detail-dock>`, and owns the drag-to-resize handle. Dragging the handle past
 * the panel's minimum snaps to the minimum, then fully collapses; dragging back
 * out during the same gesture restores it. Persistence and selection stay with
 * the consuming view — this component only reports intent via events:
 * `dock-resize` (px), `dock-size-reset` (double-click), `dock-collapse`, plus
 * `dock-position-change`/`dock-hide`
 * bubbled from the dock. The `actions-start` slot is forwarded to the dock.
 */
@customElement('dock-layout')
export class DockLayout extends LitElement {
  @property({ type: String })
  dock: DockPosition = 'right';

  /** In px; null lays the panel out at `defaultSize`. */
  @property({ attribute: false })
  size: number | null = null;

  /** Any CSS length, so a default can follow the view, as a percentage does. */
  @property({ type: String })
  defaultSize = '50%';

  @property({ type: Boolean })
  visible = false;

  @property({ attribute: false })
  sections: PaneSection[] = [];

  @property({ type: String })
  emptyText = 'Nothing selected.';

  /** Passed through to `<pane-view>`; the consumer owns them. */
  @property({ attribute: false })
  collapsed: Record<string, boolean> = {};

  @property({ type: Number })
  layoutEpoch = 0;

  @property({ attribute: false })
  maximized: string | null = null;

  // Live drag state (transient); when set, overrides `size` while dragging.
  @state()
  private _liveSize: number | null = null;
  @state()
  private _pendingCollapse = false;

  private _resizeStart: { pos: number; size: number } | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        height: 100%;
        width: 100%;
      }

      .layout {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
      }
      .layout[data-dock='right'] {
        flex-direction: row;
      }
      .layout[data-dock='left'] {
        flex-direction: row-reverse;
      }
      .layout[data-dock='bottom'] {
        flex-direction: column;
      }

      .main {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        padding: 0 var(--dock-main-inset, 0);
      }
      /* The dock sits flush to the window edge it is docked on. */
      .layout[data-open][data-dock='right'] .main {
        padding-right: 0;
      }
      .layout[data-open][data-dock='left'] .main {
        padding-left: 0;
      }

      /* Invisible until hovered, over the dock's 1px edge, as VS Code's sash is. */
      .gutter {
        flex: 0 0 var(--lana-sash-size);
        z-index: 1;
        transition: background-color 0.1s ease;
      }
      .layout[data-dock='right'] .gutter,
      .layout[data-dock='left'] .gutter {
        cursor: col-resize;
        margin: 0 var(--lana-sash-inset);
      }
      .layout[data-dock='bottom'] .gutter {
        cursor: row-resize;
        margin: var(--lana-sash-inset) 0;
      }
      .gutter:hover,
      .gutter.gutter--active {
        background-color: var(--vscode-sash-hoverBorder);
      }

      detail-dock {
        flex: 0 0 auto;
        overflow: hidden;
      }
      .layout[data-dock='right'] detail-dock {
        border-left: var(--lana-stroke) solid var(--lana-panel-divider);
      }
      .layout[data-dock='left'] detail-dock {
        border-right: var(--lana-stroke) solid var(--lana-panel-divider);
      }
      /* A size saved on one axis can exceed the other, and the window can shrink. */
      .layout:not([data-dock='bottom']) detail-dock {
        max-width: max(${unsafeCSS(MIN_SIZE)}px, 100% - ${unsafeCSS(MAIN_MIN_SIZE)}px);
      }
      .layout[data-dock='bottom'] detail-dock {
        max-height: max(${unsafeCSS(MIN_SIZE)}px, 100% - ${unsafeCSS(MAIN_MIN_SIZE)}px);
      }

      @media (prefers-reduced-motion: reduce) {
        .gutter {
          transition: none;
        }
      }
    `,
  ];

  render() {
    return html`
      <div class="layout" data-dock=${this.dock} ?data-open=${this.visible}>
        <div class="main"><slot name="main"></slot></div>
        ${
          this.visible
            ? html`
                <div
                  class="gutter"
                  @pointerdown=${this._startResize}
                  @dblclick=${this._resetSize}
                ></div>
                <detail-dock
                  style=${this._dockSizeStyle()}
                  .sections=${this.sections}
                  .emptyText=${this.emptyText}
                  .collapsed=${this.collapsed}
                  .layoutEpoch=${this.layoutEpoch}
                  .maximized=${this.maximized}
                  dock=${this.dock}
                >
                  <slot name="actions-start" slot="actions-start"></slot>
                </detail-dock>
              `
            : ''
        }
      </div>
    `;
  }

  private _currentSize(): string {
    if (this._pendingCollapse) {
      return '0px';
    }
    const size = this._liveSize ?? this.size;
    return size === null ? this.defaultSize : `${size}px`;
  }

  private _dockSizeStyle() {
    const size = this._currentSize();
    return this.dock === 'bottom' ? `height: ${size}` : `width: ${size}`;
  }

  private _shownSize(): number {
    const dock = this.renderRoot?.querySelector<HTMLElement>('detail-dock');
    return (this.dock === 'bottom' ? dock?.offsetHeight : dock?.offsetWidth) ?? MIN_SIZE;
  }

  private _maxSize(): number | null {
    const layout = this.renderRoot?.querySelector<HTMLElement>('.layout');
    return layout
      ? (this.dock === 'bottom' ? layout.clientHeight : layout.clientWidth) - MAIN_MIN_SIZE
      : null;
  }

  private _startResize = (e: PointerEvent) => {
    e.preventDefault();
    const gutter = e.currentTarget as HTMLElement;
    gutter.setPointerCapture(e.pointerId);
    gutter.classList.add('gutter--active');
    const size = this.size ?? this._shownSize();
    this._resizeStart = {
      pos: this.dock === 'bottom' ? e.clientY : e.clientX,
      size: Math.max(MIN_SIZE, Math.min(size, this._maxSize() ?? size)),
    };
    gutter.addEventListener('pointermove', this._onResizeMove);
    gutter.addEventListener('pointerup', this._endResize);
    gutter.addEventListener('lostpointercapture', this._cancelResize);
  };

  private _onResizeMove = (e: PointerEvent) => {
    if (!this._resizeStart) {
      return;
    }
    const current = this.dock === 'bottom' ? e.clientY : e.clientX;
    const delta = current - this._resizeStart.pos;
    // Dragging the gutter towards the main area grows the panel; sign by dock side.
    const grow = this.dock === 'left' ? delta : -delta;
    const max = this._maxSize() ?? this._resizeStart.size + grow;
    const raw = this._resizeStart.size + grow;

    if (raw < MIN_SIZE - COLLAPSE_OVERSHOOT) {
      this._pendingCollapse = true;
      this._liveSize = MIN_SIZE;
    } else {
      this._pendingCollapse = false;
      this._liveSize = Math.max(MIN_SIZE, Math.min(raw, Math.max(MIN_SIZE, max)));
    }
  };

  private _endResize = (e: PointerEvent) => {
    const gutter = e.currentTarget as HTMLElement;
    const collapse = this._pendingCollapse;
    const startSize = this._resizeStart?.size;
    const finalSize = this._liveSize;
    this._stopResize(gutter);
    gutter.releasePointerCapture(e.pointerId);

    if (collapse) {
      this.dispatchEvent(new CustomEvent('dock-collapse', { bubbles: true, composed: true }));
    } else if (finalSize !== null && finalSize !== startSize) {
      // A click must not store the default size, or a later default never reaches this user.
      this.dispatchEvent(
        new CustomEvent('dock-resize', {
          detail: { size: finalSize },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  // The browser took the pointer mid-drag, so no pointerup will come.
  private _cancelResize = (e: PointerEvent) => {
    this._stopResize(e.currentTarget as HTMLElement);
  };

  private _stopResize(gutter: HTMLElement): void {
    gutter.classList.remove('gutter--active');
    gutter.removeEventListener('pointermove', this._onResizeMove);
    gutter.removeEventListener('pointerup', this._endResize);
    gutter.removeEventListener('lostpointercapture', this._cancelResize);
    this._resizeStart = null;
    this._liveSize = null;
    this._pendingCollapse = false;
  }

  private _resetSize = () => {
    this.dispatchEvent(new CustomEvent('dock-size-reset'));
  };
}
