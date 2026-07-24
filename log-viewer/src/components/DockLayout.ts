/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';
import './DetailDock.js';
import type { DockPosition } from './DetailDock.js';
import type { PaneSection } from './PaneView.js';

const MIN_SIZE = 120;
// Drag past the minimum by this much to fully collapse the panel.
const COLLAPSE_OVERSHOOT = 60;

/**
 * Generic docked-panel layout host. Wraps a `main` slot beside/below a
 * `<detail-dock>`, and owns the drag-to-resize handle. Dragging the handle past
 * the panel's minimum snaps to the minimum, then fully collapses; dragging back
 * out during the same gesture restores it. Persistence and selection stay with
 * the consuming view — this component only reports intent via events:
 * `dock-resize` (px), `dock-collapse`, plus `dock-position-change`/`dock-hide`
 * bubbled from the dock.
 */
@customElement('dock-layout')
export class DockLayout extends LitElement {
  @property({ type: String })
  dock: DockPosition = 'right';

  @property({ type: Number })
  size = 500;

  @property({ type: Boolean })
  visible = false;

  @property({ attribute: false })
  sections: PaneSection[] = [];

  @property({ type: String })
  emptyText = 'Nothing selected.';

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
      }

      .gutter {
        flex: 0 0 4px;
        z-index: 1;
        background-color: var(--vscode-sideBar-border, transparent);
        transition: background-color 0.1s ease;
      }
      .layout[data-dock='right'] .gutter,
      .layout[data-dock='left'] .gutter {
        cursor: col-resize;
        margin: 0 -2px;
      }
      .layout[data-dock='bottom'] .gutter {
        cursor: row-resize;
        margin: -2px 0;
      }
      .gutter:hover,
      .gutter.gutter--active {
        background-color: var(--vscode-sash-hoverBorder);
      }

      detail-dock {
        flex: 0 0 auto;
        overflow: hidden;
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
      <div class="layout" data-dock=${this.dock}>
        <div class="main"><slot name="main"></slot></div>
        ${
          this.visible
            ? html`
                <div class="gutter" @pointerdown=${this._startResize}></div>
                <detail-dock
                  style=${this._dockSizeStyle()}
                  .sections=${this.sections}
                  .emptyText=${this.emptyText}
                  dock=${this.dock}
                ></detail-dock>
              `
            : ''
        }
      </div>
    `;
  }

  private _currentSize(): number {
    if (this._pendingCollapse) {
      return 0;
    }
    return this._liveSize ?? this.size;
  }

  private _dockSizeStyle() {
    const size = this._currentSize();
    return this.dock === 'bottom' ? `height: ${size}px` : `width: ${size}px`;
  }

  private _startResize = (e: PointerEvent) => {
    e.preventDefault();
    const gutter = e.currentTarget as HTMLElement;
    gutter.setPointerCapture(e.pointerId);
    gutter.classList.add('gutter--active');
    this._resizeStart = {
      pos: this.dock === 'bottom' ? e.clientY : e.clientX,
      size: this.size,
    };
    gutter.addEventListener('pointermove', this._onResizeMove);
    gutter.addEventListener('pointerup', this._endResize);
  };

  private _onResizeMove = (e: PointerEvent) => {
    if (!this._resizeStart) {
      return;
    }
    const current = this.dock === 'bottom' ? e.clientY : e.clientX;
    const delta = current - this._resizeStart.pos;
    // Dragging the gutter towards the main area grows the panel; sign by dock side.
    const grow = this.dock === 'left' ? delta : -delta;
    const layout = this.renderRoot?.querySelector('.layout') as HTMLElement | null;
    const max = layout
      ? (this.dock === 'bottom' ? layout.clientHeight : layout.clientWidth) - MIN_SIZE
      : this._resizeStart.size + grow;
    const raw = this._resizeStart.size + grow;

    if (raw < MIN_SIZE - COLLAPSE_OVERSHOOT) {
      this._pendingCollapse = true;
      this._liveSize = MIN_SIZE;
    } else {
      this._pendingCollapse = false;
      this._liveSize = Math.max(MIN_SIZE, Math.min(raw, Math.max(MIN_SIZE, max)));
    }
    this.requestUpdate();
  };

  private _endResize = (e: PointerEvent) => {
    const gutter = e.currentTarget as HTMLElement;
    gutter.releasePointerCapture(e.pointerId);
    gutter.classList.remove('gutter--active');
    gutter.removeEventListener('pointermove', this._onResizeMove);
    gutter.removeEventListener('pointerup', this._endResize);

    const collapse = this._pendingCollapse;
    const finalSize = this._liveSize ?? this.size;
    this._resizeStart = null;
    this._liveSize = null;
    this._pendingCollapse = false;

    if (collapse) {
      this.dispatchEvent(new CustomEvent('dock-collapse', { bubbles: true, composed: true }));
    } else {
      this.dispatchEvent(
        new CustomEvent('dock-resize', {
          detail: { size: finalSize },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };
}
