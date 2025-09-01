/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import codiconStyles from '../../styles/codicon.css';
import { globalStyles } from '../../styles/global.styles.js';
import { notificationStyles } from '../../styles/notification.styles.js';
import '../BadgeBase.js';
import { goToRow } from '../calltree-view/CalltreeView.js';
import './NotificationPanel.js';

provideVSCodeDesignSystem().register(vsCodeButton());

@customElement('notification-tag')
export class NotificationTag extends LitElement {
  @state()
  open = false;

  @property()
  notifications: Notification[] | null = null;

  colorStyles = new Map([
    ['Error', 'error'],
    ['Warning', 'warning'],
    ['Info', 'info'],
  ]);

  sortOrder = new Map([
    ['Error', 0],
    ['Warning', 1],
    ['Info', 2],
  ]);

  constructor() {
    super();
    document.addEventListener('click', (event) => {
      if (!event.composedPath().includes(this)) {
        this.open = false;
      }
    });
  }

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
        ${notificationStyles}
      }

      .icon {
        position: relative;
        width: 32px;
        height: 32px;
      }
      .icon-svg {
        width: 20px;
        height: 20px;
      }

      .icon-button {
        width: 32px;
        height: 32px;
      }

      .codicon.icon {
        font-size: 22px;
        width: 20px;
        height: 20px;
      }

      .badge-indicator {
        color: rgb(255, 255, 255);
        background-color: rgb(0, 120, 212);
        position: absolute;
        bottom: 18px;
        left: 18px;
        font-size: 9px;
        font-weight: 600;
        min-width: 8px;
        height: 16px;
        line-height: 16px;
        padding: 0px 4px;
        border-radius: 20px;
        text-align: center;
      }

      .tag-panel {
        position: absolute;
        top: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
      }

      .menu-container {
        position: relative;
      }

      .notification {
        padding: 8px 16px;
        overflow-wrap: anywhere;
        text-wrap: wrap;
        display: flex;
        gap: 8px;
        border-radius: 4px;
      }

      .text-container {
        padding: 8px 0px 0px 0px;
      }

      .error {
        background-color: var(--notification-error-background);
      }

      .warning {
        background-color: var(--notification-warning-background);
      }

      .info {
        background-color: var(--notification-information-background);
      }

      .button-bar {
        display: flex;
        align-items: center;
        height: 35px;
      }
    `,
  ];

  render() {
    if (!this.notifications) {
      return html`<badge-base .isloading=${true}></badge-base>`;
    }

    const status = this.notifications.length > 0 ? 'failure' : 'success';

    this.notifications.sort((a, b) => {
      return (this.sortOrder.get(a.severity) || 0) - (this.sortOrder.get(b.severity) || 0);
    });

    const messages: TemplateResult[] = [];

    const lastIndex = this.notifications.length - 1;
    this.notifications.forEach((item, index) => {
      const colorStyle = this.colorStyles.get(item.severity) || '';

      const buttonBar = item.timestamp
        ? html`<div class="button-bar">
            <vscode-button
              aria-label="Go To Call Tree"
              title="Go To Call Tree"
              @click=${() => {
                goToRow(item.timestamp || 0);
              }}
              >Go To Call Tree</vscode-button
            >
          </div>`
        : '';

      const content = html`<div class="text-container">
        ${item.message
          ? html`<details>
              <summary>${item.summary}</summary>
              <div class="text-container">${item.message}</div>
            </details>`
          : item.summary}
        ${buttonBar}
      </div>`;

      messages.push(html`<div class="notification ${colorStyle}">${content}</div>`);
      if (index !== lastIndex) {
        messages.push(html`<vscode-divider role="separator"></vscode-divider>`);
      }
    });

    return html`<div class="menu-container">
      <vscode-button appearance="icon">
        <badge-base status="${status}" @click="${this._toggleNotifications}"
          >${this.notifications.length} issues
        </badge-base>
      </vscode-button>
      <notification-panel class="tag-panel" .open="${this.open}">
        <div slot="items">${messages}</div>
      </notification-panel>
    </div>`;
  }

  _toggleNotifications() {
    this.open = !this.open;
  }
}

export class Notification {
  summary = '';
  message = '';
  severity: 'Error' | 'Warning' | 'Info' | 'none' = 'none';
  timestamp: number | null = null;
}
