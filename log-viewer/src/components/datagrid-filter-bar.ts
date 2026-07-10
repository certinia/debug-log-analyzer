/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

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
        .filter-bar__filters {
          display: flex;
          align-items: flex-end;
        }
      }

      .filter-bar .filter-bar__actions--right {
        align-items: flex-end;
        display: flex;
        flex: 1 1 auto;
        gap: 8px;
        justify-content: flex-end;
      }

      .filter-bar__group {
        align-items: flex-end;
        display: flex;
      }

      /* Divider between the grouping control and the action buttons. */
      .filter-bar__group.has-group::after {
        align-self: stretch;
        border-right: 1px solid var(--vscode-widget-border, transparent);
        content: '';
        margin: 2px 8px;
      }
    `,
  ];

  @state()
  private _hasGroup = false;

  private _onGroupSlotChange(event: Event) {
    this._hasGroup = (event.target as HTMLSlotElement).assignedElements().length > 0;
  }

  render() {
    return html`<div class="filter-bar">
      <div class="filter-bar__filters">
        <slot></slot>
        <slot name="filters"></slot>
      </div>

      <div class="filter-bar__actions--right">
        <div class="filter-bar__group ${this._hasGroup ? 'has-group' : ''}">
          <slot name="group" @slotchange=${this._onGroupSlotChange}></slot>
        </div>
        <slot name="actions"></slot>
      </div>
    </div>`;
  }
}
