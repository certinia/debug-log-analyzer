/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodeBadge,
  vsCodeButton,
  vsCodeDivider,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { notificationStyles } from '../../../styles/notification.styles.js';

// web components
import './NotificationPanel.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider(), vsCodeBadge());

@customElement('notification-button')
export class NotificationButton extends LitElement {
  @state()
  open = false;

  @property()
  notifications: Notification[] = [];

  colorStyles = new Map([
    ['Error', 'error'],
    ['Warning', 'warning'],
    ['Info', 'info'],
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
    css`
      :host {
        ${notificationStyles}
      }

      .notification-panel {
        position: absolute;
        top: calc(100% + 10px);
        right: 0px;
      }

      .menu-container {
        position: relative;
        display: inline-flex;
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

    const count = this.notifications.length || null;
    return html`<div class="menu-container">
      <icon-button
        ariaLabel="Notifications"
        title="Notifications"
        icon="codicon-bell"
        .badgeCount="${count}"
        @click=${this._toggleNotifications}
      ></icon-button>

      <notification-panel class="notification-panel" .open="${this.open}">
        ${messages.length ? html`<div slot="items">${messages}</div>` : html``}
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
  severity: 'Error' | 'Warning' | 'Info' = 'Info';
}
