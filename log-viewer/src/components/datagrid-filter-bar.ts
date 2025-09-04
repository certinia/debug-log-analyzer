/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

provideVSCodeDesignSystem().register();

@customElement('datagrid-filter-bar')
export class DatagridFilterBar extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      .filter-bar {
        display: flex;
      }

      .filter-bar .filter-bar__actions--right {
        align-items: center;
        display: flex;
        flex: 1 1 auto;
        justify-content: flex-end;
      }
    `,
  ];

  render() {
    return html`<div class="filter-bar">
      <div class="filter-bar__filters">
        <slot></slot>
        <slot name="filters"></slot>
      </div>

      <div class="filter-bar__actions--right">
        <slot name="actions"></slot>
      </div>
    </div>`;
  }
}
