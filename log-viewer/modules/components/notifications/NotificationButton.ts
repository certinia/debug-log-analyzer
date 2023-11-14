/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDivider } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import codiconStyles from '../../styles/codicon.css';
import { globalStyles } from '../../styles/global.styles.js';
import './NotificationPanel.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider());

@customElement('notification-button')
export class NotificationButton extends LitElement {
  @state()
  open = false;

  @property()
  notifications: Notification[] = [];

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
        top: 32px;
        right: 0px;
      }

      .icon-button {
        width: 32px;
        height: 32px;
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

      .notification-panel {
        position: absolute;
        top: calc(100% + 10px);
        right: 0px;
      }

      .menu-container {
        position: relative;
      }

      .codicon.icon {
        font-size: 22px;
        width: 20px;
        height: 20px;
      }
    `,
  ];

  render() {
    const indicator =
      this.notifications.length > 0
        ? html`<div class="badge-indicator">${this.notifications.length}</div>`
        : html``;

    return html`<div class="menu-container">
      <vscode-button
        appearance="icon"
        class="icon-button"
        aria-label="Notifications"
        title="Notifications"
        @click="${this._toggleNotifications}"
      >
        <span class="codicon icon codicon-bell"></span>
        ${indicator}
      </vscode-button>
      <notification-panel
        class="notification-panel"
        .notifications="${this.notifications}"
        .open="${this.open}"
      ></notification-panel>
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
