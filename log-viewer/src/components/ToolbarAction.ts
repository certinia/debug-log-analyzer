/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';
import { menuRowStyles } from '../styles/menuRow.styles.js';

/**
 * A grid toolbar command: an icon button on the bar, and an icon + label row once
 * `<datagrid-filter-bar>` moves it into its `…` menu. Listen for `click` on the element.
 */
@customElement('toolbar-action')
export class ToolbarAction extends LitElement {
  /** Codicon name. */
  @property()
  icon = '';

  /** The command's name: the tooltip and accessible name on the bar, the row text in the menu. */
  @property()
  label = '';

  /** Reactive mirror of the native `slot` attribute, so the action re-renders as a menu row. */
  @property({ attribute: 'slot' }) slot = '';

  static styles = [
    globalStyles,
    menuRowStyles,
    css`
      :host {
        display: inline-flex;
      }

      :host([slot='overflow']) {
        display: block;
        width: 100%;
      }
    `,
  ];

  render() {
    return this.slot === 'overflow'
      ? html`<button class="filter-popover-row menu-row">
          <vscode-icon name=${this.icon}></vscode-icon><span>${this.label}</span>
        </button>`
      : html`<vscode-toolbar-button
          icon=${this.icon}
          label=${this.label}
          title=${this.label}
        ></vscode-toolbar-button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'toolbar-action': ToolbarAction;
  }
}
