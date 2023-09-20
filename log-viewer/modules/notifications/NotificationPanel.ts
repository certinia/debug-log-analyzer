/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDivider } from '@vscode/webview-ui-toolkit';
import { LitElement, TemplateResult, css, html } from 'lit';
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
    notificationStyles,
    css`
      :host {
        z-index: 999;
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
      messages.push(html`<div class="notification ${colorStyle}">
        <div class="text-container">${item.message}</div>
      </div>`);
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

  _getIcon(severity: string) {
    return severity === 'Error'
      ? html`<svg
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          version="1.1"
          width="32"
          height="32"
          viewBox="0 0 256 256"
          xml:space="preserve"
        >
          <defs></defs>
          <g
            style="stroke: none; stroke-width: 0; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: none; fill-rule: nonzero; opacity: 1;"
            transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)"
          >
            <path
              d="M 45 88.11 h 40.852 c 3.114 0 5.114 -3.307 3.669 -6.065 L 48.669 4.109 c -1.551 -2.959 -5.786 -2.959 -7.337 0 L 0.479 82.046 c -1.446 2.758 0.555 6.065 3.669 6.065 H 45 z"
              style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(214,0,0); fill-rule: nonzero; opacity: 1;"
              transform=" matrix(1 0 0 1 0 0) "
              stroke-linecap="round"
            />
            <path
              d="M 45 64.091 L 45 64.091 c -1.554 0 -2.832 -1.223 -2.9 -2.776 l -2.677 -25.83 c -0.243 -3.245 2.323 -6.011 5.577 -6.011 h 0 c 3.254 0 5.821 2.767 5.577 6.011 L 47.9 61.315 C 47.832 62.867 46.554 64.091 45 64.091 z"
              style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(255,255,255); fill-rule: nonzero; opacity: 1;"
              transform=" matrix(1 0 0 1 0 0) "
              stroke-linecap="round"
            />
            <circle
              cx="44.995999999999995"
              cy="74.02600000000001"
              r="4.626"
              style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(255,255,255); fill-rule: nonzero; opacity: 1;"
              transform="  matrix(1 0 0 1 0 0) "
            />
          </g>
        </svg>`
      : html``;
  }
}

export class Notification {
  summary = '';
  message = '';
  severity: 'Error' | 'Warning' | 'Info' | 'none' = 'none';
}
