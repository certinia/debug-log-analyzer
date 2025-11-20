/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDivider } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// styles
import codiconStyles from '../../../styles/codicon.css';
import { globalStyles } from '../../../styles/global.styles.js';
import { notificationStyles } from '../../../styles/notification.styles.js';

// web components
import './NotificationPanel.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider());

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
    unsafeCSS(codiconStyles),
    css`
      :host {
        ${notificationStyles}
      }

      vscode-button {
        height: 22px;
        width: 22px;
      }

      .badge-indicator {
        color: rgb(255, 255, 255);
        background-color: rgb(0, 120, 212);
        position: absolute;
        top: 10px;
        left: 10px;
        font-size: 9px;
        font-weight: 600;
        min-width: 13px;
        height: 13px;
        line-height: 13px;.
        padding: 0px 2px;
        border-radius: 16px;
        text-align: center;
        box-sizing: border-box;
        display: inline-block;
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

    const indicator =
      this.notifications.length > 0
        ? html` <div class="badge-indicator">${this.notifications.length}</div> `
        : html``;

    return html`<div class="menu-container">
      <vscode-button
        appearance="icon"
        aria-label="Notifications"
        title="Notifications"
        @click="${this._toggleNotifications}"
      >
        <span class="codicon codicon-bell"></span>
        ${indicator}
      </vscode-button>
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
