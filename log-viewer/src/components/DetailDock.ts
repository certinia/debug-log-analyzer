/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';
import './PaneView.js';
import type { PaneSection } from './PaneView.js';

export type DockPosition = 'left' | 'right' | 'bottom';

/**
 * Generic details viewlet: a slim action bar (dock left/bottom/right + close)
 * over a PaneView of caller-supplied sections. View-agnostic — the consuming
 * view builds the sections. No title text.
 *
 * The `actions-start` slot takes a consumer-owned control at the free end of
 * the action bar, opposite the dock buttons.
 */
@customElement('detail-dock')
export class DetailDock extends LitElement {
  @property({ attribute: false })
  sections: PaneSection[] = [];

  @property({ type: String })
  dock: DockPosition = 'right';

  @property({ type: String })
  emptyText = 'Nothing selected.';

  /** Passed through to `<pane-view>`; the consumer owns them. */
  @property({ attribute: false })
  collapsed: Record<string, boolean> = {};

  @property({ attribute: false })
  paneSizes: Record<string, number> = {};

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: var(--vscode-sideBar-background);
        color: var(--vscode-sideBar-foreground, var(--lana-fg));
        font-family: var(--lana-font-ui);
        font-size: var(--lana-text-base);
        /* Match the docked edge (the DockLayout gutter) so the panel reads as a
           deliberate region rather than blending into the tab header above. */
        border-top: var(--lana-stroke) solid var(--lana-panel-divider);
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--lana-space-2xs);
        flex: 0 0 var(--lana-panel-header-height);
        height: var(--lana-panel-header-height);
        padding: 0 var(--lana-space-2xs);
        border-bottom: var(--lana-stroke) solid var(--lana-panel-divider);
      }
      slot[name='actions-start'] {
        display: flex;
        align-items: center;
        min-width: 0;
        margin-right: auto;
        /* The dock narrows to 120px; the dock buttons keep their room. */
        overflow: hidden;
        /* With the bar's own inset, the same content edge as the section bodies below. */
        padding-left: var(--lana-space-sm);
      }

      vscode-icon {
        flex: 0 0 auto;
        color: var(--lana-icon-fg);
        border-radius: var(--lana-radius-sm);
      }
      vscode-icon:hover {
        background-color: var(--lana-toolbar-hover-bg);
      }
      vscode-icon:active {
        background-color: var(--vscode-toolbar-activeBackground, var(--lana-toolbar-hover-bg));
      }

      pane-view {
        flex: 1 1 auto;
        min-height: 0;
      }

      .empty {
        flex: 1 1 auto;
        padding: var(--lana-space-md) var(--lana-space-lg);
        color: var(--lana-fg-muted);
      }
    `,
  ];

  render() {
    return html`
      <div class="actions">
        <slot name="actions-start"></slot>
        <vscode-icon
          action-icon
          name="layout-sidebar-left"
          label="Dock left"
          title="Dock left"
          @click=${() => this._setPosition('left')}
        ></vscode-icon>
        <vscode-icon
          action-icon
          name="layout-panel"
          label="Dock bottom"
          title="Dock bottom"
          @click=${() => this._setPosition('bottom')}
        ></vscode-icon>
        <vscode-icon
          action-icon
          name="layout-sidebar-right"
          label="Dock right"
          title="Dock right"
          @click=${() => this._setPosition('right')}
        ></vscode-icon>
        <vscode-icon
          action-icon
          name="close"
          label="Hide panel"
          title="Hide panel"
          @click=${this._hide}
        ></vscode-icon>
      </div>
      ${
        this.sections.length
          ? html`<pane-view
              orientation=${this.dock === 'bottom' ? 'horizontal' : 'vertical'}
              .sections=${this.sections}
              .collapsed=${this.collapsed}
              .paneSizes=${this.paneSizes}
            ></pane-view>`
          : html`<div class="empty">${this.emptyText}</div>`
      }
    `;
  }

  private _setPosition(position: DockPosition) {
    this.dispatchEvent(
      new CustomEvent('dock-position-change', {
        detail: { position },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _hide() {
    this.dispatchEvent(new CustomEvent('dock-hide', { bubbles: true, composed: true }));
  }
}
