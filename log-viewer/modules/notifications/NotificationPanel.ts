/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDivider } from '@vscode/webview-ui-toolkit';
import { LitElement, type TemplateResult, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../global.styles';
import { notificationStyles } from '../notification.styles';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider());

@customElement('notification-panel')
export class NotificationPanel extends LitElement {
  @property({ type: Boolean })
  open = false;

  @property()
  notifications: Notification[] = [];

  colorStyles = new Map([
    ['Error', 'error'],
    ['Warning', 'warning'],
    ['Info', 'info'],
  ]);

  static styles = [
    globalStyles,
    css`
      :host {
        z-index: 999;
        ${notificationStyles}
      }
      .container {
        background-color: var(--vscode-editor-background);
        max-height: 540px;
        width: 320px;
        padding: 8px 4px 8px 4px;
        border: calc(var(--border-width) * 1px) solid var(--divider-background);
        box-shadow: rgba(0, 0, 0, 0.5) 0px 4px 20px;
        border-radius: 4px;
        overflow: scroll;
      }

      .closed {
        display: none;
      }
      .notification {
        padding: 8px 16px;
        overflow-wrap: anywhere;
        text-wrap: wrap;
        display: flex;
        gap: 8px;
        border-radius: 4px;
      }
      .error-list {
        display: flex;
        flex-direction: column;
      }

      .notification-icon {
        justify-content: center;
        display: flex;
        flex-direction: column;
      }

      .no-messages {
        display: flex;
        justify-content: center;
      }

      .error {
        background-color: var(--notification-error-background);
      }

      .warning {
        background-color: var(--notification-warning-background);
      }

      .info {
        background-color: var(--notification-info-background);
      }

      .text-container {
        padding: 8px 0px 0px 0px;
      }
    `,
  ];

  render() {
    const sortOrder = new Map([
      ['Error', 0],
      ['Warning', 1],
      ['Info', 2],
    ]);

    this.notifications.sort((a, b) => {
      return (sortOrder.get(a.severity) || 0) - (sortOrder.get(b.severity) || 0);
    });

    const messages: TemplateResult[] = [];

    const lastIndex = this.notifications.length - 1;
    this.notifications.forEach((item, index) => {
      const colorStyle = this.colorStyles.get(item.severity) || '';

      const content = item.message
        ? html`<details>
            <summary>${item.summary}</summary>
            <div class="text-container">${item.message}</div>
          </details>`
        : html`<div class="text-container">${item.summary}</div>`;

      messages.push(html`<div class="notification ${colorStyle}">${content}</div>`);
      if (index !== lastIndex) {
        messages.push(html`<vscode-divider role="separator"></vscode-divider>`);
      }
    });

    if (this.notifications.length < 1) {
      messages.push(html`<div class="no-messages"><h3>No Messages!</h3></div>`);
    }

    return html` <div class="container ${this.open ? '' : 'closed'}">
      <div class="error-list">${html`${messages}`}</div>
    </div>`;
  }
}

export class Notification {
  summary = '';
  message = '';
  severity: 'Error' | 'Warning' | 'Info' | 'none' = 'none';
}
